import pandas as pd
df = pd.read_excel('3.xlsx')
df['图片链接'] = ''
df['上传用户'] = '' 
df['上传时间'] = ''
df.to_excel('3.xlsx', index=False)
