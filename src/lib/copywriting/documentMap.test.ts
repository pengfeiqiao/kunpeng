import test from 'node:test';
import assert from 'node:assert/strict';
import { copyTableRanges, parseTableCells, replaceCopyContentRange } from './markdownTable.ts';
import { applyCopyPatchesDetailed, buildCopyDocMap, formatCopyDocHtml } from './documentMap.ts';

const table = '| 镜号 | 花字 | 备注 |\n| --- | --- | --- |\n| 01 | | 制作提示 |\n| 02 | A\\|B | |';
test('表格空格保留列位置，转义竖线不拆列，HTML 视图显示真正的单元格', () => {
  assert.deepEqual(parseTableCells(table)?.rows, [['01', '', '制作提示'], ['02', 'A|B', '']]);
  const html = formatCopyDocHtml(table, { includeAllText: true });
  assert.match(html, /<td>01<\/td><td data-empty="true"><\/td><td>制作提示<\/td>/);
  assert.ok(!html.includes('Markdown table preserved'));
  assert.deepEqual(parseTableCells('花字 | 备注\n--- | ---\n| | 提示 |')?.rows, [['', '提示']]);
});
test('HTML 表格转义不受信任内容', () => {
  assert.ok(!formatCopyDocHtml('| A | B |\n| --- | --- |\n| <script>x</script> | |', { includeAllText: true }).includes('<script>'));
});
test('同批前方插入不使后方块编号失效', () => {
  const content = '# 标题\n\n第一段\n\n第二段';
  const blocks = buildCopyDocMap(content);
  const result = applyCopyPatchesDetailed(content, [
    { op: 'insert_before', blockId: blocks[1].id, hash: blocks[1].hash, text: '新增段落' },
    { op: 'replace_block', blockId: blocks[2].id, hash: blocks[2].hash, text: '第二段已修改' },
  ]);
  assert.equal(result.content, '# 标题\n\n新增段落\n\n第一段\n\n第二段已修改');
  assert.equal(result.applied, 2);
});
test('块移动后用唯一 hash 重定位；真正改变时原子拒绝并报告冲突', () => {
  const block = buildCopyDocMap('原文')[0];
  assert.equal(applyCopyPatchesDetailed('新增\n\n原文', [{ blockId: block.id, hash: block.hash, text: '改好' }]).content, '新增\n\n改好');
  const content = '新原文\n\n别段';
  const result = applyCopyPatchesDetailed(content, [{ blockId: 'B0002', text: '不应写入' }, { blockId: block.id, hash: block.hash, text: '旧修改' }]);
  assert.equal(result.content, content);
  assert.equal(result.conflicts.length, 1);
});
test('允许清空文本，块内查找失败不能逃逸到其他段落', () => {
  assert.equal(applyCopyPatchesDetailed(table, [{ find: '制作提示', text: '' }]).content, table.replace('制作提示', ''));
  const content = '第一段\n\n制作提示';
  assert.equal(applyCopyPatchesDetailed(content, [{ blockId: 'B0001', find: '制作提示', text: '' }]).content, content);
  assert.equal(applyCopyPatchesDetailed('重复 重复', [{ find: '重复', text: '' }]).conflicts.length, 1);
});

test('表格后紧跟标题仍分块，编辑不吞掉标题换行，重复编辑不累积空行', () => {
  const content = table + '\n## 制作要求\n正文';
  const blocks = buildCopyDocMap(content);
  assert.equal(blocks[0].kind, 'table');
  assert.equal(blocks[1].text, '## 制作要求');
  const next = replaceCopyContentRange(content, blocks[0].start, blocks[0].end, table);
  assert.equal(next, table + '\n\n## 制作要求\n正文');
  assert.equal(replaceCopyContentRange(next, 0, table.length, table), next);
});

test('预览表格范围保留 CRLF 原始坐标，代码块里的示例不作为可编辑表格', () => {
  const content = '# 标题\r\n\r\n' + table.replace(/\n/g, '\r\n') + '\r\n## 下方标题';
  const ranges = copyTableRanges(content);
  assert.equal(ranges.length, 1);
  assert.equal(content.slice(ranges[0].start, ranges[0].end), table.replace(/\n/g, '\r\n'));
  assert.equal(copyTableRanges('```md\n' + table + '\n```').length, 0);
  assert.equal(buildCopyDocMap(content)[1].text, ranges[0].raw);
});
