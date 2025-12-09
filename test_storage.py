"""
Simple test script for knowledge storage functionality
"""

import os
import sys
# Add the project directory to Python path to import knowledge_storage
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from knowledge_storage import KnowledgeStorage

def test_knowledge_storage():
    print("Testing Knowledge Storage...")
    
    # Create a test storage instance
    storage = KnowledgeStorage("./test_knowledge_store")
    
    # Test adding entries
    print("\n1. Adding test entries...")
    storage.add_entry("The capital of France is Paris", "test_user_1")
    storage.add_entry("Python is a programming language", "test_user_2")
    storage.add_entry("The Earth revolves around the Sun", "test_user_3")
    print("   Added 3 test entries")
    
    # Test searching
    print("\n2. Testing search functionality...")
    results = storage.search_entries("Paris")
    print(f"   Found {len(results)} result(s) for 'Paris':")
    for result in results:
        print(f"     - {result['content']}")
    
    # Test searching for another term
    results = storage.search_entries("Python")
    print(f"   Found {len(results)} result(s) for 'Python':")
    for result in results:
        print(f"     - {result['content']}")
    
    # Test case-insensitive search
    results = storage.search_entries("python")
    print(f"   Found {len(results)} result(s) for 'python' (lowercase):")
    for result in results:
        print(f"     - {result['content']}")
    
    # Test getting all entries
    print("\n3. Getting all entries...")
    all_entries = storage.get_all_entries()
    print(f"   Total entries: {len(all_entries)}")
    for entry in all_entries:
        print(f"     - ID: {entry['id']}, Content: {entry['content'][:30]}...")
    
    print("\nTest completed successfully!")

if __name__ == "__main__":
    test_knowledge_storage()