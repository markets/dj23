/**
 * Single source of truth for colors used outside CSS (canvas rendering,
 * inline styles). Values are read from the CSS custom properties in
 * css/variables.css so the palette only ever has to change in one place.
 */
class Theme {
  static cache = new Map();

  static color(name) {
    if (!Theme.cache.has(name)) {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue(`--${name}`)
        .trim()
        // The build may wrap a long value across lines; collapse it so the
        // result is safe to interpolate into a colour string
        .replace(/\s+/g, ' ');
      Theme.cache.set(name, value);
    }

    return Theme.cache.get(name);
  }

  /** Call after swapping the palette at runtime. */
  static clearCache() {
    Theme.cache.clear();
  }
}

window.Theme = Theme;
