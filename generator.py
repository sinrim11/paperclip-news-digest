import json
import os
from datetime import datetime

def generate_digest(input_file, template_path, output_dir):
    with open(input_file, 'r', encoding='utf-8') as f:
        articles = json.load(f)
    
    with open(template_path, 'r', encoding='utf-8') as f:
        template = f.read()

    date_str = datetime.now().strftime("%Y%m%d")
    output_file = os.path.join(output_dir, f"daily_digest_{date_str}.md")
    
    # Group articles by category
    categories = {}
    for article in articles:
        cat = article['category']
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(article)

    digest_content = f"# Daily News Digest - {datetime.now().strftime('%Y-%m-%d')}\n\n"
    
    for cat, items in categories.items():
        digest_content += f"## {cat}\n"
        for item in items:
            digest_content += f"- [{item['title']}]({item['url']})\n"
            digest_content += f"  > {item['summary']}\n\n"

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(digest_content)
    
    return output_file

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        gen_input = sys.argv[1]
        temp_path = "news_project/config/digest_template.md"
        out_dir = "news_project/output"
        out_file = generate_digest(gen_input, temp_path, out_dir)
        print(f"Digest generated: {out_file}")
    else:
        print("Please provide the input JSON file path.")
