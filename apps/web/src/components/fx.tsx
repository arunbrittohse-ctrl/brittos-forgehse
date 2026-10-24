/**
 * Visual effects: a WebGL "light field" (flowing navy/blue/teal light with a cursor spotlight),
 * 3D tilt with a specular highlight, one-shot scroll reveals and count-up numbers.
 * Every effect has a static fallback and switches off for reduced motion; the WebGL loop pauses
 * when off-screen or when the tab is hidden, and is capped at 30 fps with a reduced render scale.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type HTMLAttributes } from 'react';
import { reducedMotion, useReducedMotion } from '../lib/motion';

/* ---------------------------------------------------------------- light field */
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision mediump float;
uniform vec2 r; uniform float t; uniform vec2 m; uniform float energy;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*noise(p); p = p*2.02 + vec2(1.7, 9.2); a *= 0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / r; vec2 q = uv; q.x *= r.x / r.y;
  float tt = t * 0.045;
  vec2 w = vec2(fbm(q*1.6 + vec2(tt, -tt*0.6)), fbm(q*1.6 + vec2(-tt*0.8, tt*0.5) + 5.2));
  float f = fbm(q*2.2 + w*1.8 + tt);
  vec3 navy = vec3(0.043, 0.122, 0.231), blue = vec3(0.231, 0.510, 0.965), teal = vec3(0.078, 0.722, 0.651), plat = vec3(0.780, 0.824, 0.996);
  vec3 col = navy;
  col = mix(col, blue * 0.85, smoothstep(0.35, 0.95, f) * 0.75);
  col = mix(col, teal * 0.9, smoothstep(0.55, 1.0, w.x * f * 1.6) * 0.55);
  // light streaks ("exposure")
  float streak = pow(max(0.0, 1.0 - abs(uv.y - 0.55 - 0.18 * sin(uv.x * 3.0 + tt * 6.0)) * 5.5), 3.0);
  col += plat * streak * 0.12 * energy;
  // cursor spotlight
  vec2 mm = m; mm.x *= r.x / r.y;
  float d = distance(q, mm);
  col += blue * 0.35 * exp(-d * d * 7.0) * energy;
  // vignette
  col *= 0.72 + 0.28 * smoothstep(1.25, 0.2, distance(uv, vec2(0.45, 0.4)));
  gl_FragColor = vec4(col, 1.0);
}`;

export function LightField({ grid = true, energy = 1 }: { grid?: boolean; energy?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const host = ref.current;
    if (!host || reduced) return;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return; // CSS gradient fallback stays visible
    host.appendChild(canvas);
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, 'r'), uT = gl.getUniformLocation(prog, 't'), uM = gl.getUniformLocation(prog, 'm'), uE = gl.getUniformLocation(prog, 'energy');
    const mouse = { x: 0.7, y: 0.6, tx: 0.7, ty: 0.6 };
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5; // half-resolution: it's soft light anyway
      canvas.width = Math.max(1, Math.round(host.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(host.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    const onMove = (e: PointerEvent) => {
      const b = host.getBoundingClientRect();
      mouse.tx = (e.clientX - b.left) / b.width; mouse.ty = 1 - (e.clientY - b.top) / b.height;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    let visible = true, raf = 0, last = 0;
    const start = performance.now();
    const io = new IntersectionObserver(([en]) => { visible = !!en?.isIntersecting; if (visible) loop(performance.now()); });
    io.observe(host);
    const loop = (now: number) => {
      cancelAnimationFrame(raf);
      if (!visible || document.hidden) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return; // ~30 fps
      last = now;
      mouse.x += (mouse.tx - mouse.x) * 0.06; mouse.y += (mouse.ty - mouse.y) * 0.06;
      gl.uniform2f(uR, canvas.width, canvas.height); gl.uniform1f(uT, (now - start) / 1000); gl.uniform2f(uM, mouse.x, mouse.y); gl.uniform1f(uE, energy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const onVis = () => { if (!document.hidden) loop(performance.now()); };
    document.addEventListener('visibilitychange', onVis);
    loop(performance.now());
    return () => {
      cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      window.removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
      gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove();
    };
  }, [reduced, energy]);
  return <div ref={ref} className={`lightfield ${grid ? 'grid' : ''}`} aria-hidden />;
}

/* ---------------------------------------------------------------- tilt */
/** Adds perspective tilt and a cursor-following specular highlight. Pointer (mouse/pen) only. */
export function useTilt<T extends HTMLElement>(max = 6) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    el.classList.add('fx-tilt');
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const b = el.getBoundingClientRect();
        const px = (e.clientX - b.left) / b.width, py = (e.clientY - b.top) / b.height;
        el.style.setProperty('--ry', `${(px - 0.5) * max}deg`);
        el.style.setProperty('--rx', `${(0.5 - py) * max}deg`);
        el.style.setProperty('--mx', `${px * 100}%`);
        el.style.setProperty('--my', `${py * 100}%`);
      });
    };
    const enter = () => el.classList.add('is-hover');
    const leave = () => { cancelAnimationFrame(raf); el.classList.remove('is-hover'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave); el.classList.remove('fx-tilt', 'is-hover'); };
  }, [max]);
  return ref;
}

export function Tilt({ children, className = '', max, style, ...rest }: { children: ReactNode; className?: string; max?: number; style?: CSSProperties } & HTMLAttributes<HTMLDivElement>) {
  const ref = useTilt<HTMLDivElement>(max);
  return <div ref={ref} className={className} style={style} {...rest}>{children}</div>;
}

/* ---------------------------------------------------------------- reveal */
export function Reveal({ children, delay = 0, as: As = 'div', className = '' }: { children: ReactNode; delay?: number; as?: 'div' | 'section' | 'li'; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') { setIn(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setIn(true); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <As ref={ref as never} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ '--d': `${delay}ms` } as CSSProperties}>{children}</As>;
}

/* ---------------------------------------------------------------- count up (first render only) */
export function CountUp({ value, suffix = '' }: { value: number | null | undefined; suffix?: string }) {
  const [n, setN] = useState(value ?? 0);
  const first = useRef(true);
  useEffect(() => {
    if (value == null) return;
    if (!first.current || reducedMotion() || value === 0) { setN(value); return; }
    first.current = false;
    const start = performance.now(), dur = 700;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (value == null) return <>—</>;
  return <>{n}{suffix}</>;
}
