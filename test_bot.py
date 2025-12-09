"""
Simple test script to verify bot responds to commands
This script tests the bot's command handlers without actually running the bot
"""

import asyncio
from unittest.mock import Mock, AsyncMock
from bot import start, help_command, search, ask, add_knowledge

async def test_start_command():
    """Test /start command"""
    print("Testing /start command...")
    
    # Create mock update and context
    update = Mock()
    update.effective_user = Mock()
    update.effective_user.mention_html = Mock(return_value="@test_user")
    update.message = Mock()
    update.message.reply_html = AsyncMock()
    
    context = Mock()
    
    # Call the handler
    await start(update, context)
    
    # Verify response was sent
    assert update.message.reply_html.called, "start command should send a reply"
    print("✓ /start command works correctly")
    return True

async def test_help_command():
    """Test /help command"""
    print("Testing /help command...")
    
    update = Mock()
    update.message = Mock()
    update.message.reply_text = AsyncMock()
    
    context = Mock()
    
    # Call the handler
    await help_command(update, context)
    
    # Verify response was sent
    assert update.message.reply_text.called, "help command should send a reply"
    call_args = update.message.reply_text.call_args[0][0]
    assert "/start" in call_args, "help should mention /start"
    assert "/help" in call_args, "help should mention /help"
    print("✓ /help command works correctly")
    return True

async def test_search_command():
    """Test /search command"""
    print("Testing /search command...")
    
    update = Mock()
    update.message = Mock()
    update.message.reply_text = AsyncMock()
    
    context = Mock()
    context.args = ["test", "query"]
    
    # Call the handler
    await search(update, context)
    
    # Verify response was sent
    assert update.message.reply_text.called, "search command should send a reply"
    print("✓ /search command works correctly")
    return True

async def test_ask_command():
    """Test /ask command"""
    print("Testing /ask command...")
    
    update = Mock()
    update.message = Mock()
    update.message.reply_text = AsyncMock()
    
    context = Mock()
    context.args = ["What is Python?"]
    
    # Call the handler
    await ask(update, context)
    
    # Verify response was sent
    assert update.message.reply_text.called, "ask command should send a reply"
    print("✓ /ask command works correctly")
    return True

async def test_add_command():
    """Test /add command"""
    print("Testing /add command...")
    
    update = Mock()
    update.effective_user = Mock()
    update.effective_user.id = 12345
    update.message = Mock()
    update.message.reply_text = AsyncMock()
    
    context = Mock()
    context.args = ["New knowledge entry"]
    
    # Call the handler
    await add_knowledge(update, context)
    
    # Verify response was sent
    assert update.message.reply_text.called, "add command should send a reply"
    print("✓ /add command works correctly")
    return True

async def run_all_tests():
    """Run all tests"""
    print("=" * 50)
    print("Testing Bot Command Handlers")
    print("=" * 50)
    print()
    
    tests = [
        test_start_command,
        test_help_command,
        test_search_command,
        test_ask_command,
        test_add_command
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            result = await test()
            if result:
                passed += 1
        except Exception as e:
            print(f"✗ Test failed: {e}")
            failed += 1
    
    print()
    print("=" * 50)
    print(f"Tests completed: {passed} passed, {failed} failed")
    print("=" * 50)
    
    if failed == 0:
        print("\n✓ All tests passed! Bot should respond to commands correctly.")
    else:
        print(f"\n✗ {failed} test(s) failed. Please check the errors above.")
    
    return failed == 0

if __name__ == "__main__":
    try:
        success = asyncio.run(run_all_tests())
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ Error running tests: {e}")
        import traceback
        traceback.print_exc()
        exit(1)

