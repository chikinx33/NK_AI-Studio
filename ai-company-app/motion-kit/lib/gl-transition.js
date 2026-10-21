// gl-transitions 실행기: 두 그림(img·video·canvas) 사이를 진행도 p(0~1)로 섞어 <canvas>에 그린다.
// seek(t)에서 p 를 계산해 매번 부르면 된다(시간만으로 결정되므로 렌더러와 맞다).
// 쓰는 법: <script src="KIT/vendor/gl-transitions.js"></script><script src="KIT/lib/gl-transition.js"></script>
//   const tr = M.glTransition(canvasEl, "CrossZoom");   tr.draw(fromImg, toImg, p, { strength: 0.4 })
(function () {
  const VERT = "attribute vec2 _p;varying vec2 _uv;void main(){gl_Position=vec4(_p,0.,1.);_uv=vec2(.5,.5)*(_p+vec2(1.,1.));}";
  const HEAD = "precision highp float;varying vec2 _uv;uniform sampler2D from,to;uniform float progress,ratio,_fromR,_toR;\n" +
    "vec4 getFromColor(vec2 uv){return texture2D(from,.5+(uv-.5)*vec2(min(ratio/_fromR,1.),min(_fromR/ratio,1.)));}\n" +
    "vec4 getToColor(vec2 uv){return texture2D(to,.5+(uv-.5)*vec2(min(ratio/_toR,1.),min(_toR/ratio,1.)));}\n";
  const TAIL = "\nvoid main(){gl_FragColor=transition(_uv);}";
  const TYPE = { float: "uniform1f", int: "uniform1i", bool: "uniform1i", vec2: "uniform2fv", vec3: "uniform3fv", vec4: "uniform4fv", ivec2: "uniform2iv" };

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("셰이더 오류: " + gl.getShaderInfoLog(shader));
    return shader;
  }

  function texture(gl) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return tex;
  }

  const size = (el) => [el.videoWidth || el.naturalWidth || el.width || 1, el.videoHeight || el.naturalHeight || el.height || 1];

  window.M = window.M || {};
  window.M.glTransition = function (canvas, name) {
    const def = (window.GL_TRANSITIONS || {})[name];
    if (!def) throw new Error("없는 전환: " + name + " (KIT/vendor/gl-transitions.js 를 먼저 불러야 한다)");
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL 을 쓸 수 없다");
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, HEAD + def.glsl + TAIL));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("셰이더 연결 오류: " + gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "_p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const texFrom = texture(gl);
    const texTo = texture(gl);
    const u = (n) => gl.getUniformLocation(program, n);
    return {
      draw(from, to, p, params = {}) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texFrom);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, from);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texTo);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, to);
        gl.uniform1i(u("from"), 0);
        gl.uniform1i(u("to"), 1);
        gl.uniform1f(u("progress"), Math.min(1, Math.max(0, p)));
        gl.uniform1f(u("ratio"), canvas.width / canvas.height);
        const [fw, fh] = size(from), [tw, th] = size(to);
        gl.uniform1f(u("_fromR"), fw / fh);
        gl.uniform1f(u("_toR"), tw / th);
        const values = { ...(def.defaultParams || {}), ...params };
        for (const [key, type] of Object.entries(def.paramsTypes || {})) {
          const fn = TYPE[type];
          if (!fn || values[key] === undefined) continue;
          const value = typeof values[key] === "boolean" ? Number(values[key]) : values[key];
          gl[fn](u(key), value);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
    };
  };
})();
