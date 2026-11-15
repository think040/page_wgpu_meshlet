// .wgsl 파일 임포트와 셰이더 조립. TS 안에 WGSL 문자열을 쓰지 않는다.
import structsWgsl from './common/structs.wgsl';
import mathWgsl from './common/math.wgsl';
import lightingWgsl from './common/lighting.wgsl';
import lodSelectWgsl from './cull/lod_select.wgsl';
import instanceCullWgsl from './cull/instance_cull.wgsl';
import meshletCullWgsl from './cull/meshlet_cull.wgsl';
import meshletWgsl from './draw/meshlet.wgsl';
import staticWgsl from './draw/static.wgsl';
import overlayWgsl from './overlay/overlay.wgsl';
import { composeShader } from '../shaderLib';

const structs = { name: 'common/structs.wgsl', code: structsWgsl };
const math = { name: 'common/math.wgsl', code: mathWgsl };
const lighting = { name: 'common/lighting.wgsl', code: lightingWgsl };

export const SHADERS = {
  lodSelect: composeShader('lod_select', [structs, { name: 'cull/lod_select.wgsl', code: lodSelectWgsl }]),
  instanceCull: composeShader('instance_cull', [structs, { name: 'cull/instance_cull.wgsl', code: instanceCullWgsl }]),
  meshletCull: composeShader('meshlet_cull', [structs, { name: 'cull/meshlet_cull.wgsl', code: meshletCullWgsl }]),
  meshlet: composeShader('meshlet', [structs, math, { name: 'draw/meshlet.wgsl', code: meshletWgsl }, lighting]),
  static: composeShader('static', [structs, math, { name: 'draw/static.wgsl', code: staticWgsl }, lighting]),
  overlay: composeShader('overlay', [structs, { name: 'overlay/overlay.wgsl', code: overlayWgsl }]),
} as const;
