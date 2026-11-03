# Afterimage 👁️

**Don't blink or you'll miss it.**

Afterimage is a browser memory game. A drawing appears for 10 seconds, then disappears, and you redraw it from memory. When you're done, compare your version with the original.

## How to play
1. Pick a difficulty (Easy, Medium, or Hard) and press **Start** (or Enter).
2. Study the drawing for 10 seconds. Pay attention to the shapes, sizes, and positions.
3. Redraw it on the whiteboard with the pen, eraser, undo, and clear tools.
4. Press **Compare** to lay your drawing over the original, then try again or go to the next drawing.

## Features
- Three difficulty levels; each round picks a random category first, then a random drawing in it
- The drawing's name stays hidden until you compare
- Strokes animate in one at a time, in the order they were drawn
- Smoothed pen strokes for natural-looking lines
- Overlay comparison (yours vs. the original)
- Gallery of 12 random drawings from the set
- Keyboard shortcuts, plus light and dark mode

## Built with
Plain HTML, CSS, and JavaScript in one file, with no frameworks or build step. Drawings are stored as stroke data (lists of `[x, y]` points), drawn in with a stroke-by-stroke animation.

## Run it locally
Open `iterations/index.html` in a browser. The game loads its drawings from `assets/data/memory-game-drawings.json`. If it can't find that file, it will ask you to choose it yourself.

## Roadmap
- **Daily** mode: everyone gets the same drawing each day
- **Endless** and **Party** modes, including friends drawing pictures for each other
- Scoring that recognizes *what* you drew, so you get partial credit when you get the object right even if the lines are off
