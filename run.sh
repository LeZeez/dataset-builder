#!/bin/bash

# Synthetic Dataset Builder - Run Script

# Check for virtual environment
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies if needed
if [ ! -f "venv/.installed" ]; then
    echo "📥 Installing dependencies..."
    python3 -m pip install -r requirements.txt
    touch venv/.installed
fi

# Check for API key
if [ -z "$OPENAI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$GOOGLE_API_KEY" ]; then
    echo "⚠️  No API key found. Set one of:"
    echo "   export OPENAI_API_KEY='your-key'"
    echo "   export ANTHROPIC_API_KEY='your-key'"
    echo "   export GOOGLE_API_KEY='your-key'"
    echo ""
    echo "🔄 Starting in demo mode (generation will use placeholders)..."
fi

echo ""
echo "🗂️ Starting Synthetic Dataset Builder..."
echo ""

python3 server.py
exit_code=$?

if [ "$exit_code" -ne 0 ]; then
    echo ""
    echo "⚠️  Server exited with code $exit_code."
fi

exit "$exit_code"
