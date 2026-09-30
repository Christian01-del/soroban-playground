import os
import re

for root, _, files in os.walk('backend/tests'):
    for file in files:
        if file.endswith('.js'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r') as f:
                content = f.read()
            
            content = re.sub(r'await import\(', 'require(', content)
            content = re.sub(r'jest\.unstable_mockModule\(', 'jest.mock(', content)
            
            with open(filepath, 'w') as f:
                f.write(content)
