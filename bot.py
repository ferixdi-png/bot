"""
KIE (Knowledge Is Everything) Telegram Bot
Basic implementation to start with
"""

import logging
from telegram.ext import Application, CommandHandler, MessageHandler, filters
import os
from dotenv import load_dotenv
from knowledge_storage import KnowledgeStorage
from kie_client import get_client
import asyncio

# Load environment variables FIRST
load_dotenv()

# Enable logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

logger = logging.getLogger(__name__)

# Bot token from environment variable
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')

# Initialize knowledge storage
storage = KnowledgeStorage()
# KIE client (async)
kie = get_client()

async def start(update, context):
    """Send a message when the command /start is issued."""
    user = update.effective_user
    await update.message.reply_html(
        rf'Hi {user.mention_html()}! Welcome to KIE (Knowledge Is Everything) bot. '
        f'I am designed to help you find and share knowledge. '
        f'Use /help to see available commands.'
    )

async def help_command(update, context):
    """Send a message when the command /help is issued."""
    await update.message.reply_text(
        'Available commands:\n'
        '/start - Start the bot\n'
        '/help - Show this help message\n'
        '/search [query] - Search for knowledge\n'
        '/ask [question] - Ask a question\n'
        '/add [knowledge] - Contribute new knowledge'
    )

async def search(update, context):
    """Handle search queries."""
    query = ' '.join(context.args) if context.args else ''

    if not query:
        await update.message.reply_text('Please provide a search query. Usage: /search [query]')
        return

    # Perform search using knowledge storage
    results = storage.search_entries(query)

    if results:
        response = f'Found {len(results)} result(s) for "{query}":\n\n'
        for i, result in enumerate(results[:5], 1):  # Limit to first 5 results
            response += f'{i}. {result["content"][:100]}...\n'
            if len(result["content"]) > 100:
                response += f'   (ID: {result["id"]})\n'
            else:
                response += f'   (ID: {result["id"]})\n'
    else:
        response = f'No results found for "{query}". You can contribute knowledge using /add command.'

    await update.message.reply_text(response)

async def ask(update, context):
    """Handle questions."""
    question = ' '.join(context.args) if context.args else ''

    if not question:
        await update.message.reply_text('Please provide a question. Usage: /ask [question]')
        return

    # Try to find relevant information in knowledge storage
    results = storage.search_entries(question)

    if results:
        response = f'Based on your question "{question}", here are some relevant entries:\n\n'
        for i, result in enumerate(results[:3], 1):  # Limit to first 3 results
            response += f'{i}. {result["content"]}\n\n'
        response += 'If this doesn\'t answer your question, try rephrasing or contribute knowledge using /add.'
    else:
        # No local results — ask KIE models
        kie_model = os.getenv('KIE_DEFAULT_MODEL') or os.getenv('KIE_MODEL')

        if kie_model:
            # invoke kie model asynchronously
            try:
                kie_resp = await kie.invoke_model(kie_model, {'text': question})
                if kie_resp.get('ok'):
                    result = kie_resp.get('result')
                    # attempt to extract human-readable text
                    if isinstance(result, dict) and 'output' in result:
                        output = result['output']
                    else:
                        output = result

                    response = f'Question: {question}\n\nKIE response:\n{output}'
                else:
                    response = f'Question: {question}\n\nKIE error: {kie_resp.get("error")}'
            except Exception as e:
                response = f'Question: {question}\n\nFailed to call KIE: {e}'
        else:
            response = f'Question: {question}\n\nI couldn\'t find relevant information in my knowledge base. You can contribute knowledge using /add or rephrase your question.\nNote: No KIE model configured (set KIE_DEFAULT_MODEL or KIE_MODEL env var)'

    await update.message.reply_text(response)

async def add_knowledge(update, context):
    """Add new knowledge."""
    knowledge = ' '.join(context.args) if context.args else ''

    if not knowledge:
        await update.message.reply_text('Please provide knowledge to add. Usage: /add [knowledge]')
        return

    # Add to knowledge storage
    success = storage.add_entry(knowledge, update.effective_user.id)

    if success:
        await update.message.reply_text(f'Knowledge added successfully: "{knowledge[:50]}..."')
    else:
        await update.message.reply_text('Failed to add knowledge. Please try again.')

async def echo_non_commands(update, context):
    """Echo back non-command messages."""
    await update.message.reply_text(f'Received your message: "{update.message.text}"\n\nUse /help to see available commands.')

def main():
    """Start the bot."""
    if not BOT_TOKEN:
        logger.error("No TELEGRAM_BOT_TOKEN found in environment variables!")
        return

    # Create the Application and pass it your bot's token.
    application = Application.builder().token(BOT_TOKEN).build()

    # Add command handlers
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("search", search))
    application.add_handler(CommandHandler("ask", ask))
    application.add_handler(CommandHandler("add", add_knowledge))

    # Add message handler for non-commands
    application.add_handler(MessageHandler(~filters.COMMAND, echo_non_commands))

    # register extra handlers (models etc.)
    try:
        _register_extra_handlers(application)
    except Exception:
        # ignore if function missing or fails
        pass

    # Run the bot until the user presses Ctrl-C
    application.run_polling()


async def models_command(update, context):
    """List available models from KIE (if configured)."""
    models = await kie.list_models()
    if not models:
        await update.message.reply_text('No KIE models available or KIE API not configured.')
        return

    resp_lines = []
    for m in models[:20]:
        name = m.get('name') or m.get('id')
        desc = m.get('description', '')
        resp_lines.append(f"- {name}: {desc[:200]}")

    await update.message.reply_text('Available KIE models:\n' + '\n'.join(resp_lines))


def _register_extra_handlers(application):
    # Register async command handler for models
    application.add_handler(CommandHandler('models', models_command))

if __name__ == '__main__':
    main()