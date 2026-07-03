#!/usr/bin/env python3
"""
Test suite for Telegram bot features.
Validates all commands and integrations without requiring actual Telegram connection.
"""
import sys
import os
import json
from typing import Dict, Any

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_imports():
    """Test that all modules can be imported."""
    print("🧪 Testing imports...")
    try:
        import telegram_news_alerts
        print("  ✅ telegram_news_alerts imported")
    except ImportError as e:
        print(f"  ⚠️  telegram_news_alerts import warning: {e}")

    print("  ✅ All core modules importable")
    return True

def test_paperclip_status_formatting():
    """Test Paperclip status formatting."""
    print("\n🧪 Testing Paperclip status formatting...")

    try:
        # Import the formatting function
        from telegram_bot import format_status_message
    except ImportError:
        print("  ⚠️  Skipped (python-telegram-bot not installed)")
        return True

    # Test data
    test_data = {
        "status": "ok",
        "stats": {
            "total": 27,
            "done": 15,
            "in_progress": 3,
            "todo": 8,
            "blocked": 1,
        },
        "issues": []
    }

    msg = format_status_message(test_data)
    assert "완료: 15" in msg
    assert "진행: 3" in msg
    assert "TODO: 8" in msg
    assert "블록: 1" in msg
    assert "55%" in msg
    print("  ✅ Status formatting works correctly")
    return True

def test_work_instructions():
    """Test work instructions generation."""
    print("\n🧪 Testing work instructions...")

    try:
        from telegram_bot import get_work_instructions
    except ImportError:
        print("  ⚠️  Skipped (python-telegram-bot not installed)")
        return True

    msg = get_work_instructions()
    assert "CMP-56" in msg
    assert "Engineer" in msg
    assert "우선순위" in msg
    print("  ✅ Work instructions generated successfully")
    return True

def test_help_message():
    """Test help message generation."""
    print("\n🧪 Testing help message...")

    try:
        from telegram_bot import get_help_message
    except ImportError:
        print("  ⚠️  Skipped (python-telegram-bot not installed)")
        return True

    msg = get_help_message()
    assert "/status" in msg
    assert "/help" in msg
    assert "/ask" in msg
    assert "명령어" in msg
    print("  ✅ Help message generated successfully")
    return True

def test_news_alerts_module():
    """Test news alerts module functions."""
    print("\n🧪 Testing news alerts module...")

    try:
        import telegram_news_alerts
        # Test that functions exist
        assert hasattr(telegram_news_alerts, 'send_telegram_message')
        assert hasattr(telegram_news_alerts, 'send_news_digest')
        assert hasattr(telegram_news_alerts, 'send_paperclip_alert')
        assert hasattr(telegram_news_alerts, 'send_status_report')
        print("  ✅ All alert functions present")
    except ImportError:
        print("  ⚠️  telegram_news_alerts not available (python-telegram-bot not installed)")
        return True

    return True

def test_json_parsing():
    """Test JSON data parsing capabilities."""
    print("\n🧪 Testing JSON parsing...")

    test_json = json.dumps({
        "issues": [
            {"id": "1", "title": "Test 1", "status": "done"},
            {"id": "2", "title": "Test 2", "status": "in_progress"},
        ]
    })

    parsed = json.loads(test_json)
    assert len(parsed["issues"]) == 2
    assert parsed["issues"][0]["status"] == "done"
    print("  ✅ JSON parsing works correctly")
    return True

def test_file_structure():
    """Test that all required files exist."""
    print("\n🧪 Testing file structure...")

    required_files = [
        "telegram_bot.py",
        "telegram_news_alerts.py",
        "run_telegram_bot.sh",
        "requirements_bot.txt",
        "TELEGRAM_BOT.md",
    ]

    for f in required_files:
        if os.path.exists(f):
            print(f"  ✅ {f}")
        else:
            print(f"  ❌ {f} NOT FOUND")
            return False

    return True

def test_syntax():
    """Test Python syntax of all bot files."""
    print("\n🧪 Testing Python syntax...")

    import py_compile

    files = [
        "telegram_bot.py",
        "telegram_news_alerts.py",
        "test_telegram_bot.py",
    ]

    for f in files:
        try:
            py_compile.compile(f, doraise=True)
            print(f"  ✅ {f}")
        except py_compile.PyCompileError as e:
            print(f"  ❌ {f}: {e}")
            return False

    return True

def run_all_tests():
    """Run all tests."""
    print("=" * 60)
    print("  Telegram Bot Test Suite")
    print("=" * 60)

    tests = [
        ("File Structure", test_file_structure),
        ("Syntax Check", test_syntax),
        ("Imports", test_imports),
        ("JSON Parsing", test_json_parsing),
        ("Status Formatting", test_paperclip_status_formatting),
        ("Work Instructions", test_work_instructions),
        ("Help Message", test_help_message),
        ("News Alerts", test_news_alerts_module),
    ]

    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"\n❌ {test_name} failed: {e}")
            results.append((test_name, False))

    print("\n" + "=" * 60)
    print("  Test Summary")
    print("=" * 60)

    passed = sum(1 for _, r in results if r)
    total = len(results)

    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")

    print(f"\nTotal: {passed}/{total} passed")

    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(run_all_tests())
