/** Injected into loopback preview pages so the parent overlay can hit-test inner DOM. */

export const DCS_PICK_SCRIPT = `(function () {
  if (window.__dcsPick) return;
  window.__dcsPick = true;
  var PICK = 'dcs-pick';
  var HIT = 'dcs-pick-hit';
  var SCAN = 'dcs-pick-scan';
  var SCAN_HIT = 'dcs-pick-scan-hit';
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || event.data == null) return;
    var data = event.data;
    if (data.type === PICK) {
      parent.postMessage({ type: HIT, id: data.id, hit: describe(hitAt(data.x, data.y)) }, '*');
      return;
    }
    if (data.type === SCAN) {
      parent.postMessage({ type: SCAN_HIT, id: data.id, selectors: scan(data.rect) }, '*');
    }
  });
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var raw = event.target;
    var node = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
    if (!node || !node.closest) return;
    var anchor = node.closest('a');
    if (!anchor) return;
    var href = (anchor.href || '').trim();
    if (!href || href.indexOf('javascript:') === 0 || href.indexOf('mailto:') === 0) return;
    event.preventDefault();
    event.stopPropagation();
    parent.postMessage({ type: 'dcs-nav', href: href }, '*');
  }, true);

  function hitAt(x, y) {
    var raw = document.elementFromPoint(x, y);
    if (raw == null) return null;
    if (raw === document.documentElement) return document.body || raw;
    return raw;
  }

  function describe(el) {
    if (el == null) return null;
    var box = el.getBoundingClientRect();
    var tag = el.tagName.toLowerCase();
    var name = elementName(el);
    return {
      rect: { x: box.left, y: box.top, w: box.width, h: box.height },
      tag: tag,
      name: name,
      text: compact(el.textContent || '', 120),
      selector: selectorOf(el),
      label: labelOf(name, tag),
    };
  }

  function elementName(el) {
    var react = reactName(el);
    if (react) return react;
    var named = (el.getAttribute('name') || '').trim();
    if (named) return named;
    var data = dataName(el);
    if (data) return data;
    if (el.id) return el.id;
    var cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean)[0];
    return cls || '';
  }

  function dataName(el) {
    var keys = ['data-component', 'data-name', 'data-testid', 'data-id'];
    for (var i = 0; i < keys.length; i++) {
      var value = (el.getAttribute(keys[i]) || '').trim();
      if (value) return value;
    }
    if (!el.attributes) return '';
    for (var a = 0; a < el.attributes.length; a++) {
      var attr = el.attributes[a];
      if (attr.name.indexOf('data-') !== 0 || attr.name === 'data-dcs-pick') continue;
      var text = (attr.value || '').trim();
      if (text) return text;
    }
    return '';
  }

  function reactName(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key.indexOf('__reactFiber$') !== 0 && key.indexOf('__reactInternalInstance$') !== 0) continue;
      var fiber = el[key];
      while (fiber) {
        var name = typeName(fiber.type);
        if (name) return name;
        fiber = fiber.return;
      }
    }
    return '';
  }

  function typeName(type) {
    if (typeof type === 'function') return cap(type.displayName || type.name);
    if (type && typeof type === 'object') {
      return cap(type.displayName || type.name || (type.render && (type.render.displayName || type.render.name)) || '');
    }
    return '';
  }

  function cap(name) {
    if (!name || name === 'anonymous' || name === 'Fragment') return '';
    var first = name.charAt(0);
    return first === first.toUpperCase() && first !== first.toLowerCase() ? name : '';
  }

  function labelOf(name, tag) {
    if (!name || name.toLowerCase() === tag) return tag;
    return name + ' · ' + tag;
  }

  function selectorOf(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + el.id;
    var cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean)[0];
    if (cls) return tag + '.' + cls;
    return tag + ':nth-of-type(' + nth(el) + ')';
  }

  function nth(el) {
    var parent = el.parentElement;
    if (!parent) return 1;
    var tag = el.tagName;
    var n = 1;
    for (var i = 0; i < parent.children.length; i++) {
      var child = parent.children[i];
      if (child === el) return n;
      if (child.tagName === tag) n += 1;
    }
    return n;
  }

  function scan(rect) {
    if (rect == null) return [];
    var nodes = document.querySelectorAll('a, button, [id], h1, h2, h3, input, textarea, select, img, label, li, p');
    var found = [];
    var seen = {};
    for (var i = 0; i < nodes.length && found.length < 6; i++) {
      var node = nodes[i];
      var box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      if (rect.x >= box.left + box.width || rect.x + rect.w <= box.left) continue;
      if (rect.y >= box.top + box.height || rect.y + rect.h <= box.top) continue;
      var mark = selectorOf(node);
      if (seen[mark]) continue;
      seen[mark] = true;
      found.push(mark);
    }
    return found;
  }

  function compact(text, max) {
    var out = String(text).replace(/\\s+/g, ' ').trim();
    return out.length <= max ? out : out.slice(0, max - 1).replace(/\\s+$/, '') + '…';
  }
})();
`
