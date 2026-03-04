from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Test UI vertical stretching by expanding sidebars
        page.goto('http://127.0.0.1:5000')
        page.wait_for_selector('#app')

        # Open chat system prompt
        try:
            page.click('.chat-system-prompt .collapse-toggle')
        except:
            pass

        time.sleep(1)

        # Set viewport to mobile size
        page.set_viewport_size({"width": 375, "height": 667})
        time.sleep(1)
        page.screenshot(path='mobile_view.png', full_page=True)

        # Desktop size
        page.set_viewport_size({"width": 1280, "height": 720})
        time.sleep(1)

        # Add new prompt test
        page.click('#new-prompt-btn')
        page.keyboard.type('TestNewPrompt')
        page.keyboard.press('Enter')
        time.sleep(1)

        page.screenshot(path='desktop_view.png', full_page=True)
        browser.close()

if __name__ == '__main__':
    run()
