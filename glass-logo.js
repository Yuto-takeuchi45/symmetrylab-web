// 背景の3Dロゴ（ガラス版）：ロゴマークの水色の帯2本とグレーの三角2つを立体にして、ガラスの質感で描く。
// トップ・サービスページ（main.js）と下層ページ（sub.js）で共通に使う。
// もとは「案B グリッドなし」の試作で作ったもので、粒子版から戻すにあたり共通部品として切り出した。
import { MARK } from './mark-data.js';

/**
 * ガラスのロゴを作る。
 * @param {object} THREE three.js
 * @returns {{ group: object, matT: object, update: Function }}
 *   group：シーンに追加するロゴ全体。位置・回転・大きさは呼び出し側で決める
 *   matT：水色の帯の素材（背景の光の模様の設定に渡す）
 *   update(stateA, stateB, f, ie)：場面Aから場面Bへの途中（f＝0〜1）の形にする。ie は登場演出の進み具合（0〜1）
 */
export function createGlassLogo(THREE) {
  const lerp = THREE.MathUtils.lerp;
  // 水色の帯：つやのある樹脂のような質感。グレーの三角：透けるすりガラス
  const matT = new THREE.MeshPhysicalMaterial({ color: 0x36C9E6, roughness: .22, metalness: 0, clearcoat: 1, clearcoatRoughness: .12, sheen: .3, sheenColor: new THREE.Color(0xBDF3FF) });
  const matG = new THREE.MeshPhysicalMaterial({ color: 0xB2C4CD, roughness: .12, metalness: 0, transmission: .92, thickness: .6, ior: 1.45, clearcoat: 1, attenuationColor: new THREE.Color(0x9fb8c4), attenuationDistance: 1.2 });

  /** 多角形の重心を返す（各ピースを自分の中心で回転させるため）。 */
  const centroid = poly => { let x = 0, y = 0; poly.forEach(p => { x += p[0]; y += p[1]; }); return [x / poly.length, y / poly.length]; };
  /** ロゴの輪郭（多角形）を厚みのある立体にする。角は少し丸める。 */
  const extrude = (poly, depth) => {
    const [cx, cy] = centroid(poly);
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x - cx, y - cy)));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .035, bevelSize: .025, bevelSegments: 5, curveSegments: 8 });
    g.translate(0, 0, -depth / 2); g.computeVertexNormals();
    return { g, c: [cx, cy] };
  };

  const group = new THREE.Group();
  const pieces = [];
  // 水色の帯：上（y>0）を half 0、下を half 1。グレーの三角：右（x>0）を half 0、左を half 1
  MARK.tiffany.forEach(poly => { const { g, c } = extrude(poly, .26); pieces.push({ mesh: new THREE.Mesh(g, matT), base: c, half: c[1] > 0 ? 0 : 1, kind: 't' }); });
  MARK.grey.forEach(poly => { const { g, c } = extrude(poly, .2); pieces.push({ mesh: new THREE.Mesh(g, matG), base: c, half: c[0] > 0 ? 0 : 1, kind: 'g' }); });
  pieces.forEach(p => { p.mesh.position.set(p.base[0], p.base[1], 0); group.add(p.mesh); });

  /** ピースを指定の位置（絶対位置）に置くためのずれと回転を返す。 */
  const at = (p, pos, rot = {}) => { const k = p.kind + p.half, q = pos[k]; return { o: [q[0] - p.base[0], q[1] - p.base[1], q[2]], r: rot[k] || [0, 0, 0] }; };
  // 場面ごとの各ピースの置き方（元の位置からのずれ o と回転 r）
  const pieceState = {
    intro: p => ({ o: [p.base[0] * 4 + (p.half ? -2 : 2), p.base[1] * 3 + (p.kind === 't' ? 1.5 : -1.5), -3 + p.half * 2], r: [p.half ? 2 : -2, p.kind === 't' ? 1.5 : -1.2, p.half ? 1 : -1] }),
    none: () => ({ o: [0, 0, 0], r: [0, 0, 0] }),
    split: p => ({ o: [p.half ? 1.55 : -1.55, p.half ? -.1 : .1, 0], r: [0, p.half ? -.35 : .35, 0] }),
    steps: p => at(p, { t0: [.45, .38, .3], t1: [-.45, -.42, .15], g0: [1.4, 1.2, .45], g1: [-1.4, -1.25, 0] }),
    tree: p => at(p, { t0: [-1.35, 0, 0], g0: [.35, 1, .35], g1: [.35, -1, -.35], t1: [1.45, 0, 0] }, { t0: [0, 0, -.55], t1: [0, 0, .55] }),
    modules: p => at(p, { t0: [-.62, .62, 0], g0: [.62, .62, .4], g1: [-.62, -.62, .4], t1: [.62, -.62, 0] }, { g0: [0, 0, .3], g1: [0, 0, .3] }),
    exploded: p => ({ o: [p.base[0] * .45, p.base[1] * .45, p.kind === 't' ? (p.half ? .7 : -.7) : (p.half ? -1.3 : 1.3)], r: [0, 0, 0] })
  };
  /** 場面の名前から置き方を返す。未登録の名前は組み上がった状態（none）として扱う。 */
  const stateOf = name => pieceState[name] || pieceState.none;

  /** 場面Aから場面Bへの途中（f）の形に、各ピースを配置する。ie が1未満の間は登場演出の位置と混ぜる。 */
  const update = (stateA, stateB, f, ie) => {
    const sA = stateOf(stateA), sB = stateOf(stateB);
    pieces.forEach(p => {
      const sa = sA(p), sb = sB(p), si = pieceState.intro(p);
      const o = [0, 1, 2].map(k => lerp(sa.o[k], sb.o[k], f) * ie + si.o[k] * (1 - ie));
      const r = [0, 1, 2].map(k => lerp(sa.r[k], sb.r[k], f) * ie + si.r[k] * (1 - ie));
      p.mesh.position.set(p.base[0] + o[0], p.base[1] + o[1], o[2]);
      p.mesh.rotation.set(r[0], r[1], r[2]);
    });
  };
  return { group, matT, update };
}
