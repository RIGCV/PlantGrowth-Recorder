"""Build static PDF fonts from OFL-licensed Google Noto sources.
Inputs: tmp/fonts/NotoSansSC.ttf and NotoSerifSC.ttf from google/fonts (see docs).
Renamed because these are static derivatives. Requires fonttools.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
for source, family in [('NotoSansSC', 'JournalSans'), ('NotoSerifSC', 'JournalSerif')]:
    font = TTFont(root / 'tmp' / 'fonts' / f'{source}.ttf')
    font = instantiateVariableFont(font, {'wght': 400}, inplace=True)
    # This document engine lays out Chinese/Latin text directly. Removing the enormous
    # pan-CJK substitution tables avoids fontkit scanning them for every line.
    # Glyph outlines and Unicode mappings are kept intact.
    for table in ['GSUB', 'GPOS', 'GDEF', 'BASE', 'JSTF']:
        if table in font:
            del font[table]
    # fontkit switches small PDF subsets to 16-bit loca offsets. Every glyph
    # must start on an even offset; Google source fonts use compact odd lengths.
    # Padding at source fixes truncated offsets without patching dependencies.
    font['glyf'].padding = 4
    names = {1: family, 2: 'Regular', 3: f'{family}-Regular-v1', 4: f'{family} Regular', 6: f'{family}-Regular', 16: family, 17: 'Regular'}
    for record in font['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    font.flavor = None
    target = root / 'public' / 'fonts' / f'{family}-Regular.ttf'
    font.save(target)
    print(target.name, target.stat().st_size)
