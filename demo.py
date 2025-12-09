"""
Demo script for KIE Telegram Bot functionality
This demonstrates how the bot would respond to various commands
"""

import sys
import os
# Add the project directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from knowledge_storage import KnowledgeStorage

def demo_bot():
    """Demonstrate bot functionality."""
    print("KIE Telegram Bot Demo")
    print("=" * 30)
    
    # Initialize storage
    storage = KnowledgeStorage()
    
    print("\n1. Simulating /start command:")
    print("Bot response: Hi! Welcome to KIE (Knowledge Is Everything) bot. I am designed to help you find and share knowledge. Use /help to see available commands.")
    
    print("\n2. Simulating /help command:")
    print("Bot response: Available commands:\n/start - Start the bot\n/help - Show this help message\n/search [query] - Search for knowledge\n/ask [question] - Ask a question\n/add [knowledge] - Contribute new knowledge")
    
    print("\n3. Simulating /search 'Python':")
    results = storage.search_entries("Python")
    if results:
        response = f'Found {len(results)} result(s) for "Python":\n\n'
        for i, result in enumerate(results[:5], 1):  # Limit to first 5 results
            response += f'{i}. {result["content"][:100]}...\n'
            if len(result["content"]) > 100:
                response += f'   (ID: {result["id"]})\n'
            else:
                response += f'   (ID: {result["id"]})\n'
    else:
        response = f'No results found for "Python". You can contribute knowledge using /add command.'
    print(f"Bot response: {response}")
    
    print("\n4. Simulating /ask 'What is photosynthesis?':")
    question = "photosynthesis"
    results = storage.search_entries(question)
    
    if results:
        response = f'Based on your question "What is photosynthesis?", here are some relevant entries:\n\n'
        for i, result in enumerate(results[:3], 1):  # Limit to first 3 results
            response += f'{i}. {result["content"]}\n\n'
        response += 'If this doesn\'t answer your question, try rephrasing or contribute knowledge using /add.'
    else:
        response = f'Question: What is photosynthesis?\n\nI couldn\'t find relevant information in my knowledge base. You can contribute knowledge using /add or rephrase your question.'
    
    print(f"Bot response: {response}")
    
    print("\n5. Simulating /add 'Machine learning is a subset of artificial intelligence':")
    success = storage.add_entry("Machine learning is a subset of artificial intelligence", "demo_user")
    if success:
        response = f'Knowledge added successfully: "Machine learning is a subset of artificial intelligence"'
    else:
        response = 'Failed to add knowledge. Please try again.'
    print(f"Bot response: {response}")
    
    print("\n6. Verifying the new entry was added:")
    results = storage.search_entries("Machine learning")
    if results:
        print(f"Found {len(results)} result(s) for 'Machine learning':")
        for result in results:
            print(f"  - {result['content']}")
    else:
        print("No results found for 'Machine learning'")
    
    print("\nDemo completed! The bot is ready to handle real requests when connected to Telegram.")

if __name__ == "__main__":
    demo_bot()