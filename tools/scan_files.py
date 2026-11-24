#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

ALLOWED_EXTENSIONS = {
    '.pdf': 'PDF', '.doc': 'DOC', '.docx': 'DOC', '.ppt': 'PPT', '.pptx': 'PPT',
    '.xls': 'XLS', '.xlsx': 'XLS', '.txt': 'TXT', '.zip': 'ZIP', '.rar': 'RAR', '.7z': '7Z'
}
SOURCES = ['PDFFiles', 'Handout']


def readable_size(file_path: Path) -> str:
    size = file_path.stat().st_size
    if size < 1024:
        return f'{size}B'
    if size < 1024 * 1024:
        return f'{size / 1024:.1f}KB'
    return f'{size / (1024 * 1024):.1f}MB'


def should_include(file_path: Path) -> bool:
    if file_path.name.startswith('.'):
        return False
    if file_path.name.lower() in {'desktop.ini', 'thumbs.db', '.ds_store'}:
        return False
    return file_path.suffix.lower() in ALLOWED_EXTENSIONS


def scan(root: Path) -> dict:
    file_data = {}
    for source in SOURCES:
        source_dir = root / source
        if not source_dir.exists():
            continue
        for category_dir in source_dir.iterdir():
            if not category_dir.is_dir():
                continue
            category = category_dir.name
            file_data.setdefault(category, [])
            for file_path in sorted(category_dir.iterdir(), key=lambda p: p.name):
                if not file_path.is_file() or not should_include(file_path):
                    continue
                ext = file_path.suffix.lower()
                file_data[category].append({
                    'title': file_path.stem,
                    'category': category,
                    'size': readable_size(file_path),
                    'classify': ALLOWED_EXTENSIONS[ext],
                    'url': f'{source}/{category}/{file_path.name}',
                    'source': source,
                })
    return dict(sorted(file_data.items(), key=lambda item: item[0]))


def main():
    parser = argparse.ArgumentParser(description='扫描 PDFFiles 和 Handout，生成前端 file_data.json。')
    parser.add_argument('--root', default='frontend', help='站点前端根目录，默认 frontend')
    parser.add_argument('--output', default=None, help='输出 JSON 路径，默认 <root>/file_data.json')
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output = Path(args.output).resolve() if args.output else root / 'file_data.json'
    data = scan(root)
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'已生成 {output}')
    print(f'分类数：{len(data)}，文件数：{sum(len(v) for v in data.values())}')


if __name__ == '__main__':
    main()
