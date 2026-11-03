**Afterimage**: don't blink or you'll miss it.

A drawing memory game that works like an eye exam. You get 10 seconds to look at a little doodle (a fish in a top hat, say), then the eye blinks shut and you redraw it from memory. Your score comes back as a vision rating, and 20/20 is the goal.

**[Play it here](https://boqibama.github.io/afterimage/)**

Pick Easy, Normal or Hard. Easy is one character just standing there, and Hard is a whole little scene. There's one scored daily exam with the same doodle for everyone, plus endless and party modes (2 to 4 people pass the mouse around) that you can play as much as you want.

How the scoring works: every doodle is built from simple shapes (ovals, rectangles, triangles, lines, arcs and dots) on a 20 × 20 grid. The grader finds each part in your strokes and checks its shape (40%), size (25%), position (20%) and which way it's turned (15%). The big, recognizable parts count the most, and random extra ink costs you points. It's all geometry, no pixel matching and no AI. After each exam there's a full report showing what it found and where every point went.

The code:
- `js/doodles.js` makes the doodles, a new one every day
- `js/grader.js` scores your drawing against it
- `js/game.js` is the game itself, and `style.css` is the look

There's no build step and nothing to install. Just open index.html, or play it at the link above.
