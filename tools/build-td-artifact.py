"""把守塔原型打包成一個獨立檔案，給 Artifact 用。

Artifact 只吃單一頁面，沒辦法再去抓 data/core300.js 和 art.js，
所以這支把兩個 <script src> 換成內嵌的內容。

    python3 tools/build-td-artifact.py <輸出路徑>
"""
import sys, os, re

SRC = 'games/tower-defense/index.html'


def main(out):
    html = open(SRC, encoding='utf-8').read()
    for tag, path in [
        ('<script src="../../data/core300.js"></script>', 'data/core300.js'),
        ('<script src="./art.js"></script>', 'games/tower-defense/art.js'),
    ]:
        assert tag in html, tag
        html = html.replace(tag, '<script>\n' + open(path, encoding='utf-8').read() + '\n</script>')

    # Artifact 的頁面不要 <!DOCTYPE>／<html>／<head>／<body> 外框
    # （charset 留著，本機直接開檔或預覽時才不會變亂碼）
    html = re.sub(r'^<!DOCTYPE html>\s*', '', html)
    html = html.replace('<html lang="zh-Hant">\n<head>\n', '')
    html = html.replace('</head>\n<body>\n', '')
    html = html.replace('</body>\n</html>\n', '')

    open(out, 'w', encoding='utf-8').write(html)
    print('%s  (%.0f KB)' % (out, os.path.getsize(out) / 1024))


if __name__ == '__main__':
    main(sys.argv[1])
