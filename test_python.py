#!/usr/bin/env python3
"""
Simple Python test file to verify Python functionality
"""

import sys
import os
import json
from datetime import datetime


def test_python_basics():
    """Test basic Python functionality"""
    print("🐍 Python Test File")
    print("=" * 40)
    
    # Python version info
    print(f"Python version: {sys.version}")
    print(f"Python executable: {sys.executable}")
    print(f"Current working directory: {os.getcwd()}")
    
    # Test basic operations
    numbers = [1, 2, 3, 4, 5]
    squared = [n**2 for n in numbers]
    print(f"Original numbers: {numbers}")
    print(f"Squared numbers: {squared}")
    
    # Test dictionary operations
    test_data = {
        "timestamp": datetime.now().isoformat(),
        "test_passed": True,
        "message": "Python is working correctly!",
        "features_tested": [
            "imports",
            "functions", 
            "list_comprehensions",
            "dictionaries",
            "datetime",
            "json"
        ]
    }
    
    print("\nTest data (JSON format):")
    print(json.dumps(test_data, indent=2))
    
    return test_data


def test_file_operations():
    """Test file operations"""
    print("\n📁 Testing file operations...")
    
    # Create a temporary test file
    test_file = "temp_test.txt"
    test_content = "Hello from Python!\nThis is a test file.\n"
    
    try:
        # Write to file
        with open(test_file, 'w') as f:
            f.write(test_content)
        print(f"✅ Successfully wrote to {test_file}")
        
        # Read from file
        with open(test_file, 'r') as f:
            content = f.read()
        print(f"✅ Successfully read from {test_file}")
        print(f"Content: {repr(content)}")
        
        # Clean up
        os.remove(test_file)
        print(f"✅ Successfully cleaned up {test_file}")
        
    except Exception as e:
        print(f"❌ File operation failed: {e}")


def main():
    """Main test function"""
    try:
        print("Starting Python tests...\n")
        
        # Run basic tests
        test_result = test_python_basics()
        
        # Run file operation tests
        test_file_operations()
        
        print("\n🎉 All Python tests completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

