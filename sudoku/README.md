# 九格档案 · Sudoku Archive

一个纯静态 HTML5 数独游戏，包含简单、普通、高级、骨灰级四档难度，每档 100 道唯一解关卡，共 400 道题。游戏进度、草稿、用时和错误记录保存在浏览器本地。

## 本地运行

直接打开 `index.html` 即可游玩；也可以在项目根目录启动任意静态文件服务器。

```bash
npm run generate
npm run test:unit
npm run test:browser
```

`tools/generate-puzzles.mjs` 使用固定种子生成可复现题库，并在移除线索时验证唯一解。GitHub Pages 发布时，使用 `sudoku/` 目录作为站点根目录。

## 操作

- 点击棋盘空格，再点击数字键盘或按键盘 `1`—`9` 输入。
- 使用方向键移动选中格，`Backspace` / `Delete` 清除。
- “检查答案”会标出仍需核对的数字。
- 顶部可以暂停计时或重置当前关卡。
