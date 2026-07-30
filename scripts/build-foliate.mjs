import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const bundle = await rollup({
  input: fileURLToPath(new URL('../web/foliate-entry.js', import.meta.url)),
  plugins: [
    {
      name: 'epub-only',
      resolveId(source) {
        if (source === './pdf.js') return '\0foliate-pdf-disabled';
        return null;
      },
      load(id) {
        if (id === '\0foliate-pdf-disabled') {
          return `export const makePDF = async () => { throw new Error('PDF is not enabled in this EPUB reader') }`;
        }
        return null;
      },
    },
    {
      name: 'mowen-paged-surface',
      transform(code, id) {
        if (!id.replace(/\\/g, '/').endsWith('foliate-js/paginator.js')) return null;
        const boxedViewport = `#container {
            grid-column: 2 / 5;
            grid-row: 2;
            overflow: hidden;
        }`;
        const fullPageViewport = `#container {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            overflow: hidden;
        }`;
        const directTouchScroll = `    #onTouchStart(e) {
        const touch = e.changedTouches[0]
        this.#touchState = {
            x: touch?.screenX, y: touch?.screenY,
            t: e.timeStamp,
            vx: 0, xy: 0,
        }
    }
    #onTouchMove(e) {
        const state = this.#touchState
        if (state.pinched) return
        state.pinched = globalThis.visualViewport.scale > 1
        if (this.scrolled || state.pinched) return
        if (e.touches.length > 1) {
            if (this.#touchScrolled) e.preventDefault()
            return
        }
        e.preventDefault()
        const touch = e.changedTouches[0]
        const x = touch.screenX, y = touch.screenY
        const dx = state.x - x, dy = state.y - y
        const dt = e.timeStamp - state.t
        state.x = x
        state.y = y
        state.t = e.timeStamp
        state.vx = dx / dt
        state.vy = dy / dt
        this.#touchScrolled = true
        this.scrollBy(dx, dy)
    }
    #onTouchEnd() {
        this.#touchScrolled = false
        if (this.scrolled) return

        // XXX: Firefox seems to report scale as 1... sometimes...?
        // at this point I'm basically throwing \`requestAnimationFrame\` at
        // anything that doesn't work
        requestAnimationFrame(() => {
            if (globalThis.visualViewport.scale === 1)
                this.snap(this.#touchState.vx, this.#touchState.vy)
        })
    }`;
        const compositedTouchDrag = `    #onTouchStart(e) {
        const touch = e.changedTouches[0]
        this.#touchState = {
            x: touch?.screenX, y: touch?.screenY,
            t: e.timeStamp,
            vx: 0, xy: 0, drag: 0,
        }
    }
    #onTouchMove(e) {
        const state = this.#touchState
        if (state.pinched) return
        state.pinched = globalThis.visualViewport.scale > 1
        if (this.scrolled || state.pinched) return
        if (e.touches.length > 1) {
            if (this.#touchScrolled) e.preventDefault()
            return
        }
        e.preventDefault()
        const touch = e.changedTouches[0]
        const x = touch.screenX, y = touch.screenY
        const dx = state.x - x, dy = state.y - y
        const dt = e.timeStamp - state.t
        state.x = x
        state.y = y
        state.t = e.timeStamp
        state.vx = dx / dt
        state.vy = dy / dt
        state.drag += this.#vertical ? dy : dx
        const visualOffset = (this.#rtl && !this.#vertical ? 1 : -1) * state.drag
        const transform = this.#vertical
            ? \`translate3d(0, \${visualOffset}px, 0)\`
            : \`translate3d(\${visualOffset}px, 0, 0)\`
        this.#view.element.style.transform = transform
        this.#view.element.style.willChange = 'transform'
        this.#touchScrolled = true
    }
    #onTouchEnd() {
        this.#touchScrolled = false
        if (this.scrolled) return

        // Commit one real scroll only after the finger lifts. During the drag,
        // translate3d keeps the whole rendered page on the compositor.
        const state = this.#touchState
        this.#view.element.style.removeProperty('transform')
        this.#view.element.style.removeProperty('will-change')
        if (state.drag) this.scrollBy(this.#vertical ? 0 : state.drag,
            this.#vertical ? state.drag : 0)

        requestAnimationFrame(() => {
            if (globalThis.visualViewport.scale === 1)
                this.snap(state.vx, state.vy)
        })
    }`;
        if (!code.includes(boxedViewport)) throw new Error('Foliate paginator layout changed; update Mowen page-surface patch');
        if (!code.includes(directTouchScroll)) throw new Error('Foliate paginator touch handling changed; update Mowen motion patch');
        return { code: code.replace(boxedViewport, fullPageViewport).replace(directTouchScroll, compositedTouchDrag), map: null };
      },
    },
    nodeResolve({ browser: true }),
  ],
});
const { output } = await bundle.generate({
  format: 'iife',
  inlineDynamicImports: true,
  generatedCode: 'es2015',
});
await bundle.close();

const code = output.find((item) => item.type === 'chunk')?.code;
if (!code) throw new Error('Foliate bundle did not produce JavaScript');

const outputDirectory = new URL('../src/generated/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  new URL('foliateBundle.ts', outputDirectory),
  `// Generated by npm run build:foliate. Foliate-js commit is pinned in package.json.\nexport const FOLIATE_BUNDLE = ${JSON.stringify(code)};\n`,
);
