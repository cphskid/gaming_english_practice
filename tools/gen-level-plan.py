"""把第二、三章的字切成一關一關，寫進 data/level-plan.json。

    python3 tools/gen-level-plan.py

**為什麼不在 levels.ts 裡現算**：關卡考哪些字一旦上線就不能再動，不然學生
已經三星的關卡會換成一批沒看過的字，老師報表也對不起來。所以切法算一次、存成檔、
進版控；之後題庫要調，改這支再重跑，差異在 diff 裡看得到。

切法（2026-09-25 跟 Chuck 談定的）：
- 主題照課綱表三，由具體排到抽象；功能字（代名詞、介系詞、連接詞、助動詞）放在章末，
  就是那幾關「文法字」。
- 一關約 24 字，跟第一章差不多；大主題（動作、名詞）切成好幾關。
- 每五關一個魔王關，魔王關也有自己的字，不是複習關——這樣每個字都有一關會考到。
- 中文一樣的兩個字（mouse／rat 都是「老鼠」）不能在同一關，不然題目是「老鼠」時
  兩隻怪都對。碰到了就跟隔壁關同主題的字交換。
"""
import json, math, collections

WB = json.load(open('data/words2000.json'))['words']
NAME = {
    'numbers': '數字', 'colors': '顏色', 'body': '身體', 'animals': '動物', 'food': '食物',
    'tableware': '餐具', 'clothing': '衣服', 'house': '家裡', 'family': '家人', 'school': '學校',
    'places': '地方', 'transportation': '交通', 'sports': '運動', 'jobs': '職業', 'weather': '天氣',
    'time': '時間', 'wh-words': '疑問詞', 'people': '人物', 'traits': '個性外表', 'health': '健康',
    'money': '金錢', 'sizes': '大小形狀', 'countries': '國家', 'holidays': '節慶', 'geography': '地理',
    'nouns': '名詞', 'verbs': '動作', 'adjectives': '形容詞', 'adverbs': '副詞', 'pronouns': '代名詞',
    'auxiliaries': '助動詞', 'prepositions': '介系詞', 'conjunctions': '連接詞', 'feelings': '感覺',
}
# 由具體到抽象。同一個 [] 裡的主題會排在一起，小主題靠這樣併成一關。
ORDER = [
    ['numbers'], ['colors', 'body', 'health'], ['animals', 'geography'], ['food', 'tableware'],
    ['clothing', 'money'], ['house'], ['family', 'people'], ['school'], ['places'],
    ['transportation', 'countries', 'holidays'], ['sports'], ['jobs'], ['weather', 'time'],
    ['sizes'], ['traits'], ['adjectives'], ['verbs'], ['nouns'], ['adverbs'],
    ['wh-words', 'pronouns'], ['prepositions'], ['conjunctions', 'auxiliaries'],
]
# 章的關數。第一章 14 關已上線不動；合起來 85 關。
COUNT = {2: 38, 3: 33}
CN = '一二三四五六七八九十'


def chapter_levels(tier):
    words = [w for w in WB if w['tier'] == tier]
    rank = {t: i for i, grp in enumerate(ORDER) for t in grp}
    missing = {w['theme'] for w in words} - set(rank)
    assert not missing, missing
    # 同主題裡：要拼的、短的排前面（先練比較好上手的）
    words.sort(key=lambda w: (rank[w['theme']], not w['spell'], len(w['word']), w['word'].lower()))
    n = COUNT[tier]
    size = len(words) / n
    # 等分切，但切點附近 ±5 字內有主題交界的話就挪到交界上，一關才不會只剩兩三個別的主題的字
    cuts = [0]
    for k in range(1, n):
        c = round(k * size)
        best = c
        for d in range(0, 6):
            for cc in (c - d, c + d):
                if cuts[-1] + 14 < cc < len(words) - 14 and words[cc - 1]['theme'] != words[cc]['theme']:
                    best = cc; break
            else:
                continue
            break
        cuts.append(best)
    cuts.append(len(words))
    chunks = [words[cuts[i]:cuts[i + 1]] for i in range(n)]
    fix_zh_clash(chunks)
    return chunks


def fix_zh_clash(chunks):
    for _ in range(5):
        moved = False
        for i, ch in enumerate(chunks):
            seen = {}
            for w in list(ch):
                if w['zh'] in seen:
                    # 跟隔壁關換一個同主題、中文不撞的字
                    for j in (i + 1, i - 1, i + 2, i - 2):
                        if not 0 <= j < len(chunks): continue
                        zj = {x['zh'] for x in chunks[j]}
                        zi = {x['zh'] for x in ch if x is not w}
                        cand = [x for x in chunks[j] if x['zh'] not in zi and w['zh'] not in zj - {x['zh']}]
                        same = [x for x in cand if x['theme'] == w['theme']] or cand
                        if same:
                            x = same[0]
                            ch[ch.index(w)] = x; chunks[j][chunks[j].index(x)] = w
                            moved = True
                            break
                    break
                seen[w['zh']] = w
        if not moved: break
    for i, ch in enumerate(chunks):
        c = collections.Counter(w['zh'] for w in ch)
        dup = [k for k, v in c.items() if v > 1]
        assert not dup, (i, dup)


def build():
    plan = []
    no = 15
    for tier in (2, 3):
        chunks = chapter_levels(tier)
        # 每個主題在這一章被切成幾段，名字才知道要不要加「一、二、三」
        part_total = collections.Counter()
        seq = []
        for ch in chunks:
            cnt = collections.Counter(w['theme'] for w in ch)
            main = [t for t, v in cnt.most_common() if v >= 5][:2] or [cnt.most_common(1)[0][0]]
            seq.append((ch, main))
            if len(main) == 1: part_total[main[0]] += 1
        part_no = collections.Counter()
        for i, (ch, main) in enumerate(seq):
            boss = (i + 1) % 5 == 0
            label = '與'.join(NAME[t] for t in main)
            if len(main) == 1 and part_total[main[0]] > 1:
                part_no[main[0]] += 1
                label += '・' + CN[part_no[main[0]] - 1]
            if boss: label += '魔王'
            themes = [t for t, _ in collections.Counter(w['theme'] for w in ch).most_common()]
            plan.append({'no': no, 'chapter': tier, 'name': label, 'boss': boss,
                         'themes': themes, 'wordIds': sorted(w['id'] for w in ch)})
            no += 1
    assert no - 1 == 85, no - 1
    all_ids = [i for p in plan for i in p['wordIds']]
    assert len(all_ids) == len(set(all_ids)) == sum(1 for w in WB if w['tier'] > 1)
    with open('data/level-plan.json', 'w') as f:
        f.write('[\n' + ',\n'.join(json.dumps(p, ensure_ascii=False) for p in plan) + '\n]\n')
    for p in plan:
        print(p['no'], p['chapter'], p['name'], len(p['wordIds']), ','.join(p['themes']))


build()
