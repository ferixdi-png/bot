"""
Setup script for KIE Telegram Bot
"""

import os
import subprocess
import sys

def install_requirements():
    """Install required packages."""
    print("Installing required packages...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
    print("Requirements installed successfully!")

def create_env_file():
    """Create a .env file if it doesn't exist."""
    if not os.path.exists(".env"):
        print("Creating .env file...")
        with open(".env.example", "r") as example_file:
            env_content = example_file.read()
        
        with open(".env", "w") as env_file:
            env_file.write(env_content)
        
        print("Created .env file. Please update it with your bot token!")
    else:
        print(".env file already exists.")

def create_directories():
    """Create necessary directories."""
    directories = ["knowledge_store", "logs"]
    for directory in directories:
        if not os.path.exists(directory):
            os.makedirs(directory)
            print(f"Created directory: {directory}")
        else:
            print(f"Directory already exists: {directory}")

def main():
    print("Setting up KIE Telegram Bot...")
    
    # Create directories
    create_directories()
    
    # Create .env file if needed
    create_env_file()
    
    # Install requirements
    install_requirements()
    
    print("\nSetup completed!")
    print("To run the bot:")
    print("1. Get a bot token from @BotFather on Telegram")
    print("2. Update the .env file with your bot token")
    print("3. Run: python bot.py")

if __name__ == "__main__":
    main()