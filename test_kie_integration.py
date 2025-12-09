#!/usr/bin/env python3
"""
Quick test script to validate KIE API integration.
Run: python test_kie_integration.py
"""

import asyncio
import os
from dotenv import load_dotenv

# Load environment variables FIRST before importing kie_client
load_dotenv('.env')

# Now import kie_client (which will pick up env vars)
from kie_client import KIEClient

async def main():
    client = KIEClient()
    
    print("=" * 60)
    print("KIE Integration Test")
    print("=" * 60)
    
    # Check configuration
    print(f"\n1. Configuration Check:")
    print(f"   API URL: {client.base_url}")
    print(f"   API Key set: {'✓' if client.api_key else '✗ (MISSING)'}")
    print(f"   Timeout: {client.timeout}s")
    
    if not client.api_key:
        print("\n❌ ERROR: KIE_API_KEY not set in .env")
        return
    
    # Test: List models
    print(f"\n2. Listing available models...")
    try:
        models = await client.list_models()
        if models:
            print(f"   ✓ Got {len(models)} model(s)")
            for i, m in enumerate(models[:5], 1):
                name = m.get('name') or m.get('id')
                print(f"      {i}. {name}")
            if len(models) > 5:
                print(f"      ... and {len(models) - 5} more")
        else:
            print(f"   ℹ No models returned (or empty list)")
    except Exception as e:
        print(f"   ✗ Error listing models: {e}")
    
    # Test: Invoke a model (if default model is set)
    default_model = os.getenv('KIE_DEFAULT_MODEL')
    if default_model:
        print(f"\n3. Testing model invocation (model: {default_model})...")
        try:
            result = await client.invoke_model(default_model, {"text": "Hello, KIE!"})
            if result.get('ok'):
                print(f"   ✓ Model invocation successful")
                output = result.get('result')
                if isinstance(output, dict):
                    print(f"   Response: {output}")
                else:
                    print(f"   Response: {str(output)[:200]}")
            else:
                error = result.get('error')
                print(f"   ✗ Model invocation failed: {error}")
        except Exception as e:
            print(f"   ✗ Error invoking model: {e}")
    else:
        print(f"\n3. Skipping model invocation (KIE_DEFAULT_MODEL not set)")
    
    print("\n" + "=" * 60)
    print("Test complete!")
    print("=" * 60)

if __name__ == '__main__':
    asyncio.run(main())
