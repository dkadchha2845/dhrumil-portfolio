import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove the first two <figure class="frame"> elements (A·01 and A·02)
# They span from line 276 to 293. Let's use regex to find and remove them.
# The pattern for a frame is: <figure class="frame".*?</figure>
frames_pattern = re.compile(r'(\s*<figure class="frame".*?data-num="A·0[12]".*?</figure>)', re.DOTALL)
content = re.sub(frames_pattern, '', content)

# 2. Shift all data-frame="X" attributes down by 2 in .sheet__cell
def shift_data_frame(match):
    idx = int(match.group(1))
    return f'data-frame="{idx - 2}"'
content = re.sub(r'data-frame="(\d+)"', shift_data_frame, content)

# 3. Shift the A·XX numbers in the reel. A·03 -> A·01, A·60 -> A·58
def shift_a_num(match):
    num = int(match.group(1))
    new_num = num - 2
    return f'A·{new_num:02d}'
content = re.sub(r'A·(\d+)', shift_a_num, content)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
