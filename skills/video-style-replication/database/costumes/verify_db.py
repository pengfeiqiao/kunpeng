import json
from pathlib import Path

db_path = Path("regional_modern_costume_db.json")
with open(db_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

regions = list(data['regional_modern_costume_db'].keys())
print(f'数据库加载成功！')
print(f'包含 {len(regions)} 个地域\n')
print('\n前10个地域:')
for i, range(min(10, len(regions))):
    print(f'  {i+1}. {regions[i]}')

print('\n验证完成！')