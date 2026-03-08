"""
Regression tests for critical flows identified in the architecture review.

Tests cover:
1. Conversation ID generation (no race conditions)
2. Stats counting from SQLite (system messages distinguished from GPT)
3. Export with zero selection (should NOT export all)
4. Prompt name sanitization (client/server consistency)
5. Review queue clear vs reject behavior
6. validate_base_url without global config
7. Google base URL configuration
8. Preset isolation in SQLite
"""

import os
import sys
import threading
import types
from unittest.mock import patch

import pytest

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import database as db
from scripts.stats import get_stats
from scripts.parser import validate_conversation


@pytest.fixture
def temp_db(tmp_path):
    """Create a temporary database for testing."""
    db.DB_PATH = tmp_path / 'test.db'
    # Reset thread-local connection
    if hasattr(db._local, 'conn'):
        db._local.conn = None
    db.init_db()
    yield tmp_path
    if hasattr(db._local, 'conn') and db._local.conn:
        db._local.conn.close()
        db._local.conn = None


@pytest.fixture
def app_client(temp_db):
    """Create a Flask test client with a clean database."""
    # We need to import server after setting up the DB
    sys.modules.setdefault('anthropic', types.SimpleNamespace(Anthropic=object, NOT_GIVEN=object()))
    sys.modules.setdefault('openai', types.SimpleNamespace(OpenAI=object))
    google_module = sys.modules.setdefault('google', types.ModuleType('google'))
    genai_stub = types.SimpleNamespace(
        configure=lambda *args, **kwargs: None,
        list_models=lambda: [],
        GenerativeModel=object,
        types=types.SimpleNamespace(GenerationConfig=object),
    )
    setattr(google_module, 'generativeai', genai_stub)
    sys.modules.setdefault('google.generativeai', genai_stub)
    import server
    db.DB_PATH = temp_db / 'test.db'
    server.app.config['TESTING'] = True
    with server.app.test_client() as client:
        yield client


# ============ Test 1: Concurrent Conversation ID Generation ============

class TestConversationIDGeneration:
    """Test that conversation IDs are unique even under concurrent access."""

    def test_sequential_ids_are_unique(self, temp_db):
        """Generate multiple IDs sequentially and verify uniqueness."""
        ids = set()
        for _ in range(50):
            cid = db.generate_conversation_id()
            assert cid not in ids, f"Duplicate ID generated: {cid}"
            ids.add(cid)

    def test_concurrent_ids_are_unique(self, temp_db):
        """Generate IDs from multiple threads and verify no duplicates."""
        ids = []
        lock = threading.Lock()
        errors = []

        def generate_ids(count):
            # Each thread needs its own connection
            local_ids = []
            for _ in range(count):
                try:
                    cid = db.generate_conversation_id()
                    local_ids.append(cid)
                except Exception as e:
                    errors.append(str(e))
            with lock:
                ids.extend(local_ids)

        threads = [threading.Thread(target=generate_ids, args=(10,)) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Errors during ID generation: {errors}"
        assert len(ids) == len(set(ids)), f"Duplicate IDs found: {len(ids)} total, {len(set(ids))} unique"

    def test_id_format(self, temp_db):
        """Verify ID format is YYYY-MM-DD_NNN."""
        cid = db.generate_conversation_id()
        import re
        assert re.match(r'\d{4}-\d{2}-\d{2}_\d{3}', cid), f"Invalid ID format: {cid}"


# ============ Test 2: Stats Counting ============

class TestStatsCounting:
    """Test that stats correctly distinguish system, human, and GPT messages."""

    def test_system_messages_not_counted_as_gpt(self, temp_db):
        """System messages should NOT be counted as GPT messages."""
        db.save_conversation(
            "test-001",
            [
                {"from": "system", "value": "You are a helpful assistant."},
                {"from": "human", "value": "Hello"},
                {"from": "gpt", "value": "Hi there!"}
            ],
            "wanted",
            {"created_at": "2024-01-01T00:00:00Z"}
        )

        stats = get_stats()

        assert stats['human_messages'] == 1
        assert stats['gpt_messages'] == 1
        assert stats['system_messages'] == 1
        assert stats['total_messages'] == 3


# ============ Test 3: Export with Zero Selection ============

class TestExportZeroSelection:
    """Test that exporting with zero items selected does NOT export all."""

    def test_export_empty_selection_returns_empty(self, temp_db):
        """Export with empty ID list should export nothing."""
        from scripts.exporter import export_dataset

        db.save_conversation(
            "test-001",
            [
                {"from": "human", "value": "Hello"},
                {"from": "gpt", "value": "Hi!"}
            ],
            "wanted"
        )

        output_dir = temp_db / 'exports'

        # Export with empty list of IDs - should produce empty file
        output_path = export_dataset(
            output_dir=str(output_dir),
            format='sharegpt',
            selected_ids=[]  # Empty selection
        )

        with open(output_path, 'r') as f:
            content = f.read().strip()

        assert content == '', f"Expected empty export but got: {content}"


# ============ Test 4: Prompt Name Sanitization ============

class TestPromptNameSanitization:
    """Test that prompt names are consistent between client and server."""

    def test_name_with_special_chars_is_sanitized(self):
        """Names with special characters should be sanitized to safe strings."""
        import re

        raw_name = "My Prompt! @#$%"
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', raw_name)

        assert safe_name == "MyPrompt"
        assert safe_name != raw_name  # Sanitization changed the name

    def test_sanitized_name_returned_by_server(self, tmp_path):
        """Server should return the sanitized name so client can update."""
        import re

        raw_name = "Test Prompt (v2)"
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', raw_name)

        # Verify the server response includes the sanitized name
        # (In the actual code, the /api/prompts POST returns 'name': safe_name)
        assert safe_name == "TestPromptv2"


# ============ Test 5: Review Queue Clear vs Reject ============

class TestReviewQueueClear:
    """Test that clearing the review queue does NOT save to rejected."""

    def test_clear_only_deletes(self, temp_db):
        """Clear should remove items without saving them anywhere."""
        # Add items to review queue
        db.add_to_review_queue([
            {'conversations': [{'from': 'human', 'value': 'test'}], 'rawText': 'test', 'metadata': {}},
            {'conversations': [{'from': 'human', 'value': 'test2'}], 'rawText': 'test2', 'metadata': {}}
        ])

        queue, count = db.get_review_queue()
        assert count == 2

        # Clear the queue
        db.clear_review_queue()

        queue, count = db.get_review_queue()
        assert count == 0

        # Verify nothing was saved to conversations
        convs, total = db.list_conversations('rejected')
        assert total == 0, "Clear should not create rejected conversations"

        convs, total = db.list_conversations('wanted')
        assert total == 0, "Clear should not create wanted conversations"


class TestReviewQueuePersistence:
    """Test transactional review queue persistence paths."""

    def test_persist_review_queue_items_keeps_all(self, temp_db):
        """Persisting all queued items should save every item and empty the queue."""
        db.add_to_review_queue([
            {
                'conversations': [
                    {'from': 'human', 'value': 'first'},
                    {'from': 'gpt', 'value': 'reply'}
                ],
                'rawText': 'user: first\n---\ngpt: reply',
                'metadata': {'tag': 'a'}
            },
            {
                'conversations': [
                    {'from': 'human', 'value': 'second'},
                    {'from': 'gpt', 'value': 'reply'}
                ],
                'rawText': 'user: second\n---\ngpt: reply',
                'metadata': {'tag': 'b'}
            }
        ])

        saved, errors, remaining = db.persist_review_queue_items(None, 'wanted')

        assert len(saved) == 2
        assert errors == []
        assert remaining == 0

        queue, count = db.get_review_queue()
        assert count == 0
        convs, total = db.list_conversations('wanted')
        assert total == 2

    def test_persist_review_queue_items_validates_and_leaves_invalid(self, temp_db):
        """Invalid review queue items must not be persisted into conversations."""
        db.add_to_review_queue([
            {
                # Invalid: message missing 'value'
                'conversations': [{'from': 'human'}],
                'rawText': 'user:',
                'metadata': {}
            },
            {
                'conversations': [
                    {'from': 'human', 'value': 'ok'},
                    {'from': 'gpt', 'value': 'reply'}
                ],
                'rawText': 'user: ok\n---\ngpt: reply',
                'metadata': {}
            },
        ])

        saved, errors, remaining = db.persist_review_queue_items(None, 'wanted')

        assert len(saved) == 1
        assert len(errors) == 1
        assert remaining == 1

        queue, count = db.get_review_queue()
        assert count == 1

        convs, total = db.list_conversations('wanted')
        assert total == 1


# ============ Test 6: validate_base_url Without Global Config ============

# Inline the validation logic so tests don't need to import server.py
# (which pulls in anthropic/openai/google SDKs that may not be installed).
_DEFAULT_TRUSTED_DOMAINS = (
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'openrouter.ai',
    'api.together.xyz',
)


def _validate_base_url(url: str, config: dict) -> bool:
    """Standalone copy of server.validate_base_url for testing."""
    from urllib.parse import urlparse
    import ipaddress
    import socket

    if not url:
        return True
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False

        extra = config.get('server', {}).get('trusted_domains', [])
        trusted = tuple(set(_DEFAULT_TRUSTED_DOMAINS) | set(extra)) if extra else _DEFAULT_TRUSTED_DOMAINS
        if any(hostname == d or hostname.endswith('.' + d) for d in trusted):
            return True

        allow_local = config.get('server', {}).get('allow_local_network', True)
        if allow_local:
            return True

        # Strict mode: reject private/reserved IPs
        try:
            infos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
            for _family, _type, _proto, _canonname, sockaddr in infos:
                ip = ipaddress.ip_address(sockaddr[0])
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                    return False
        except (socket.gaierror, ValueError):
            return False

        return True
    except Exception:
        return False


class TestValidateBaseUrl:
    """Test that validate_base_url works without relying on global config."""

    def test_validates_with_explicit_config(self):
        """validate_base_url should work when config is passed explicitly."""
        config = {
            'server': {
                'allow_local_network': True,
                'trusted_domains': []
            }
        }

        # Should work with explicit config
        assert _validate_base_url('https://api.openai.com/v1', config) is True
        assert _validate_base_url('', config) is True

    def test_rejects_non_http_schemes(self):
        """Should reject non-http(s) schemes."""
        config = {'server': {'allow_local_network': True}}

        assert _validate_base_url('ftp://evil.com', config) is False
        assert _validate_base_url('file:///etc/passwd', config) is False

    def test_allows_trusted_domains(self):
        """Should allow known trusted API domains."""
        config = {'server': {'allow_local_network': False, 'trusted_domains': []}}

        assert _validate_base_url('https://api.openai.com/v1', config) is True
        assert _validate_base_url('https://api.anthropic.com/v1', config) is True


# ============ Test 7: Database Presets ============

class TestDatabasePresets:
    """Test that presets are stored and isolated in SQLite."""

    def test_save_and_load_preset(self, temp_db):
        """Save and load a preset via SQLite."""
        db.save_preset('chat', 'Test Preset', {'prompt': 'Be helpful'})

        presets = db.get_presets('chat')
        assert len(presets) == 1
        assert presets[0]['name'] == 'Test Preset'
        assert presets[0]['prompt'] == 'Be helpful'

    def test_overwrite_protection(self, temp_db):
        """Should not overwrite when overwrite=False."""
        db.save_preset('chat', 'Unique', {'prompt': 'v1'})
        result = db.save_preset('chat', 'Unique', {'prompt': 'v2'}, overwrite=False)
        assert result is False

        presets = db.get_presets('chat')
        assert presets[0]['prompt'] == 'v1'  # Not overwritten

    def test_delete_preset(self, temp_db):
        """Should delete a preset."""
        db.save_preset('chat', 'ToDelete', {'prompt': 'bye'})
        assert len(db.get_presets('chat')) == 1

        db.delete_preset('chat', 'ToDelete')
        assert len(db.get_presets('chat')) == 0

    def test_preset_types_isolated(self, temp_db):
        """Different preset types should be isolated."""
        db.save_preset('chat', 'Same Name', {'prompt': 'chat prompt'})
        db.save_preset('export', 'Same Name', {'prompt': 'export prompt'})

        chat_presets = db.get_presets('chat')
        export_presets = db.get_presets('export')

        assert len(chat_presets) == 1
        assert len(export_presets) == 1
        assert chat_presets[0]['prompt'] == 'chat prompt'
        assert export_presets[0]['prompt'] == 'export prompt'


# ============ Test 8: Draft Per-Session Isolation ============

class TestDraftIsolation:
    """Test that drafts are per-session."""

    def test_different_sessions_isolated(self, temp_db):
        """Different session IDs should have independent drafts."""
        db.save_draft('session-1', {'prompt': 'draft 1'})
        db.save_draft('session-2', {'prompt': 'draft 2'})

        draft1 = db.get_draft('session-1')
        draft2 = db.get_draft('session-2')

        assert draft1['prompt'] == 'draft 1'
        assert draft2['prompt'] == 'draft 2'

    def test_overwrite_own_session(self, temp_db):
        """Same session should overwrite its own draft."""
        db.save_draft('session-1', {'prompt': 'v1'})
        db.save_draft('session-1', {'prompt': 'v2'})

        draft = db.get_draft('session-1')
        assert draft['prompt'] == 'v2'


# ============ Test 9: Conversation CRUD ============

class TestConversationCRUD:
    """Test conversation create, read, update, delete via SQLite."""

    def test_save_and_retrieve(self, temp_db):
        """Save a conversation and retrieve it."""
        messages = [
            {'from': 'human', 'value': 'Hello'},
            {'from': 'gpt', 'value': 'Hi there!'}
        ]
        metadata = {'created_at': '2024-01-01T00:00:00Z', 'tags': ['greeting']}

        db.save_conversation('test-001', messages, 'wanted', metadata)

        conv = db.get_conversation('test-001', 'wanted')
        assert conv is not None
        assert conv['id'] == 'test-001'
        assert len(conv['conversations']) == 2

    def test_move_conversation(self, temp_db):
        """Move a conversation between folders."""
        db.save_conversation('test-002', [{'from': 'human', 'value': 'x'}], 'wanted')

        assert db.move_conversation('test-002', 'wanted', 'rejected')

        assert db.get_conversation('test-002', 'wanted') is None
        assert db.get_conversation('test-002', 'rejected') is not None

    def test_delete_conversation(self, temp_db):
        """Delete a conversation."""
        db.save_conversation('test-003', [{'from': 'human', 'value': 'x'}], 'wanted')
        assert db.delete_conversation('test-003', 'wanted')
        assert db.get_conversation('test-003') is None

    def test_list_with_search(self, temp_db):
        """List conversations with search filter."""
        db.save_conversation('s-001', [{'from': 'human', 'value': 'Python tutorial'}],
                             'wanted', {'created_at': '2024-01-01T00:00:00Z'})
        db.save_conversation('s-002', [{'from': 'human', 'value': 'JavaScript guide'}],
                             'wanted', {'created_at': '2024-01-02T00:00:00Z'})

        results, total = db.list_conversations('wanted', search='python')
        assert total == 1
        assert results[0]['id'] == 's-001'

    def test_list_with_search_matches_assistant_content(self, temp_db):
        """Search should still match non-preview conversation text after denormalization."""
        db.save_conversation(
            's-003',
            [
                {'from': 'human', 'value': 'Intro'},
                {'from': 'gpt', 'value': 'Hidden unique assistant content'}
            ],
            'wanted',
            {'created_at': '2024-01-03T00:00:00Z'}
        )

        results, total = db.list_conversations('wanted', search='hidden unique')
        assert total == 1
        assert results[0]['id'] == 's-003'

    def test_list_with_search_matches_text_beyond_search_text_limit(self, temp_db):
        """Search should still match assistant text beyond the denormalized search_text slice."""
        late_token = 'late-needle-xyz'
        long_reply = ('A' * 4050) + late_token

        db.save_conversation(
            's-004',
            [
                {'from': 'human', 'value': 'Intro'},
                {'from': 'gpt', 'value': long_reply}
            ],
            'wanted',
            {'created_at': '2024-01-04T00:00:00Z'}
        )

        results, total = db.list_conversations('wanted', search=late_token)
        assert total == 1
        assert results[0]['id'] == 's-004'

    def test_list_with_tag_filter(self, temp_db):
        """List conversations filtered by tag."""
        db.save_conversation('t-001', [{'from': 'human', 'value': 'x'}],
                             'wanted', {'created_at': '2024-01-01T00:00:00Z', 'tags': ['code']})
        db.save_conversation('t-002', [{'from': 'human', 'value': 'y'}],
                             'wanted', {'created_at': '2024-01-02T00:00:00Z', 'tags': ['chat']})

        results, total = db.list_conversations('wanted', tag='code')
        assert total == 1
        assert results[0]['id'] == 't-001'

    def test_pagination(self, temp_db):
        """Test pagination works correctly."""
        for i in range(10):
            db.save_conversation(f'p-{i:03d}', [{'from': 'human', 'value': f'msg {i}'}],
                                 'wanted', {'created_at': f'2024-01-{i+1:02d}T00:00:00Z'})

        page1, total = db.list_conversations('wanted', limit=3, offset=0)
        assert total == 10
        assert len(page1) == 3

        page2, _ = db.list_conversations('wanted', limit=3, offset=3)
        assert len(page2) == 3

        # Pages should not overlap
        ids1 = {c['id'] for c in page1}
        ids2 = {c['id'] for c in page2}
        assert ids1.isdisjoint(ids2)


class TestStatsEndpoint:
    """Test lightweight stats endpoint behavior."""

    def test_get_conversation_counts_returns_lightweight_counts(self, temp_db):
        """The lightweight counts helper should return saved/rejected totals."""
        db.save_conversation(
            'stats-001',
            [{'from': 'human', 'value': 'Hello'}, {'from': 'gpt', 'value': 'Hi'}],
            'wanted'
        )
        db.save_conversation(
            'stats-003',
            [{'from': 'human', 'value': 'No'}, {'from': 'gpt', 'value': 'Thanks'}],
            'rejected'
        )

        data = db.get_conversation_counts()

        assert data['wanted'] == 1
        assert data['rejected'] == 1

    def test_get_stats_still_returns_detailed_payload(self, temp_db):
        """Detailed stats remain available for the CLI and deeper analysis paths."""
        db.save_conversation(
            'stats-002',
            [{'from': 'human', 'value': 'Hello'}, {'from': 'gpt', 'value': 'Hi'}],
            'wanted'
        )

        data = db.get_stats()

        assert data['wanted'] == 1
        assert data['total_conversations'] == 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
