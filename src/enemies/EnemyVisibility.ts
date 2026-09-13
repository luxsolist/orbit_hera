import * as THREE from "three";

/** Local visibility corridor. Keeps opaque depth/raycast behavior outside the corridor. */
export class EnemyVisibility {
  private eye = { value: new THREE.Vector3() };
  private direction = { value: new THREE.Vector3() };
  private drone = { value: new THREE.Vector3() };
  private end = { value: new THREE.Vector3() };
  private enabled = { value: 1 };

  setEnabled(enabled: boolean): void { this.enabled.value = enabled ? 1 : 0; }

  update(camera: THREE.Camera, drone: THREE.Vector3): void {
    camera.getWorldPosition(this.eye.value);
    camera.getWorldDirection(this.direction.value);
    this.drone.value.copy(drone);
    this.end.value.copy(drone);
    const direction = drone.clone().sub(this.eye.value).normalize();
    this.end.value.addScaledVector(direction, 4);

  }

  /** Soft energy bodies retain the same main-camera drone visibility corridor. */
  applySoft(material: THREE.ShaderMaterial): void {
    Object.assign(material.uniforms,{visibilityEye:this.eye,visibilityEnd:this.end,visibilityDrone:this.drone,visibilityDirection:this.direction,visibilityEnabled:this.enabled});
    material.vertexShader='varying vec3 visibilityWorld;\n'+material.vertexShader;
    material.vertexShader=material.vertexShader.replace('tex=uv;', 'visibilityWorld=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;tex=uv;');
    material.fragmentShader=`varying vec3 visibilityWorld;
      uniform vec3 visibilityEye,visibilityEnd,visibilityDrone,visibilityDirection;
      uniform float visibilityEnabled;\n`+material.fragmentShader;
    material.fragmentShader=material.fragmentShader.replace('#include <tonemapping_fragment>', `
      vec3 corridor=visibilityEnd-visibilityEye;
      float along=clamp(dot(visibilityWorld-visibilityEye,corridor)/max(dot(corridor,corridor),.001),0.,1.);
      float radial=distance(visibilityWorld,visibilityEye+along*corridor);
      vec3 rayDirection=normalize(visibilityWorld-visibilityEye);
      float rayDepth=max(0.,dot(visibilityDrone-visibilityEye,rayDirection));
      radial=min(radial,distance(visibilityEye+rayDirection*rayDepth,visibilityDrone));
      vec3 viewDirection=-vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]);
      float corridorActive=(1.-step(.05,distance(cameraPosition,visibilityEye)))*step(.999,dot(viewDirection,visibilityDirection));
      gl_FragColor.a*=1.-.94*(1.-smoothstep(1.8,3.2,radial))*visibilityEnabled*corridorActive;
      #include <tonemapping_fragment>
    `);
  }

  apply(material: THREE.MeshBasicMaterial): void {
    material.onBeforeCompile = shader => {
      shader.uniforms.visibilityDirection = this.direction;
      shader.uniforms.visibilityDrone = this.drone;
      shader.uniforms.visibilityEye = this.eye;
      shader.uniforms.visibilityEnd = this.end;
      shader.uniforms.visibilityEnabled = this.enabled;
      shader.vertexShader = 'varying vec3 visibilityWorld; varying vec4 visibilityBounds;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 visibilityLocal = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          visibilityLocal = instanceMatrix * visibilityLocal;
        #endif
        visibilityWorld = (modelMatrix * visibilityLocal).xyz;
        vec4 objectCenter = vec4(0.0, 0.0, 0.0, 1.0);
        float objectRadius = 1.0;
        #ifdef USE_INSTANCING
          objectCenter = instanceMatrix * objectCenter;
          objectRadius = max(length(instanceMatrix[0].xyz), max(length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)));
        #endif
        visibilityBounds = vec4((modelMatrix * objectCenter).xyz, objectRadius);
        #include <project_vertex>
      `);
      shader.fragmentShader = `
        varying vec4 visibilityBounds;
        varying vec3 visibilityWorld;
        uniform vec3 visibilityDirection;
        uniform vec3 visibilityDrone;
        uniform vec3 visibilityEye;
        uniform vec3 visibilityEnd;
        uniform float visibilityEnabled;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        vec3 corridor = visibilityEnd - visibilityEye;
        float along = clamp(dot(visibilityWorld - visibilityEye, corridor) / max(dot(corridor, corridor), 0.001), 0.0, 1.0);
        float radial = distance(visibilityWorld, visibilityEye + along * corridor);
        // Only the main camera: rear-view rendering must remain unaffected.
        float activeView = 1.0 - step(0.05, distance(cameraPosition, visibilityEye));
        vec3 viewDirection = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        activeView *= step(0.999, dot(viewDirection, visibilityDirection));
        // Large shells can enclose the camera and drone: their distant surface still occludes the body.
        float nearBody = 1.0 - smoothstep(visibilityBounds.w + 2.0, visibilityBounds.w + 5.0, distance(visibilityBounds.xyz, visibilityDrone));
        vec3 rayDirection = normalize(visibilityWorld - visibilityEye);
        float rayDepth = max(0.0, dot(visibilityDrone - visibilityEye, rayDirection));
        float bodyRayDistance = distance(visibilityEye + rayDirection * rayDepth, visibilityDrone);
        radial = mix(radial, min(radial, bodyRayDistance), nearBody);
        float fade = (1.0 - smoothstep(1.8, 3.2, radial)) * visibilityEnabled * activeView;
        // Stable screen-space coverage avoids transparent-instance sorting artifacts.
        float noise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
        if (noise < fade * 0.94) discard;
        outgoingLight = mix(outgoingLight, min(outgoingLight, vec3(0.65)), fade);
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey = () => 'enemy-visibility-corridor-v2';
  }
}
