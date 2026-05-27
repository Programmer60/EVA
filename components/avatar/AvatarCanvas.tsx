"use client"

import React, { useEffect, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { Environment, OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm"
import { useLoader } from "@react-three/fiber"
import type { AvatarExpression, GazeTarget } from "@/lib/avatar/avatarEngine"

class CanvasErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: "red", padding: "20px", background: "rgba(0,0,0,0.8)", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          Failed to load Avatar: <br/>{this.state.error?.message}
        </div>
      )
    }
    return this.props.children
  }
}

type AvatarCanvasProps = {
  modelUrl?: string
  emotion?: string
  expression?: AvatarExpression
  gaze?: GazeTarget
  isBlinking?: boolean
  isSpeaking?: boolean
  breatheScale?: number
  browDrift?: number
  headDrift?: number
}

function VrmModel({
  modelUrl = "/CuteGirl.vrm",
  emotion,
  expression,
  gaze,
  isBlinking,
  isSpeaking,
  headDrift = 0,
}: AvatarCanvasProps) {
  const [vrm, setVrm] = useState<VRM | null>(null)

  const gltf = useLoader(GLTFLoader, modelUrl, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  useEffect(() => {
    if (gltf.userData.vrm) {
      const vrmInst = gltf.userData.vrm as VRM
      
      // Fix VRM model facing backward by rotating 180 degrees (Math.PI)
      vrmInst.scene.rotation.y = Math.PI;

      // Fix T-Pose: Relax the arms downwards procedurally
      const leftArm = vrmInst.humanoid?.getNormalizedBoneNode("leftUpperArm")
      const rightArm = vrmInst.humanoid?.getNormalizedBoneNode("rightUpperArm")
      if (leftArm) leftArm.rotation.z = 1.1 // Rotate arm down
      if (rightArm) rightArm.rotation.z = -1.1 // Rotate arm down
      
      setVrm(vrmInst)
    }
  }, [gltf])

  useFrame((state, delta) => {
    if (!vrm) return

    const t = state.clock.elapsedTime

    // 1. Update Physics (hair, clothes)
    vrm.update(delta)

    // 2. Head and Body procedural movements (Breathing & Sway)
    // We apply this to the root group so it works regardless of VRM bone mapping
    const root = vrm.scene
    if (root) {
      root.position.y = Math.sin(t * 1.4) * 0.01 // Gentle breathing bob
      root.rotation.y = Math.PI + Math.sin(t * 0.35) * 0.05 + (gaze?.x ?? 0) * 0.1 // Sway (preserve 180 deg base rotation)
      root.rotation.z = Math.sin(t * 0.8) * 0.01 // Slight tilt
    }

    // Apply specific head bone rotation if available (but let VRMLookAt handle primary gaze)
    const headNode = vrm.humanoid?.getNormalizedBoneNode("head")
    if (headNode) {
      // Subtle additive head drift, but keep eyes focused on camera
      headNode.rotation.x = headDrift * 0.03
    }

    // Enable eye contact with user
    if (vrm.lookAt) {
      vrm.lookAt.target = state.camera;
    }

    // 3. Expressions (BlendShapes)
    // We try BOTH VRM 0.0 and VRM 1.0 preset names to ensure compatibility
    if (vrm.expressionManager) {
      const exp = vrm.expressionManager
      
      const setBoth = (name0: string, name1: string, val: number) => {
        try { exp.setValue(name0, val) } catch(e){}
        try { exp.setValue(name1, val) } catch(e){}
      }

      // Reset all standard expressions
      setBoth("joy", "happy", 0)
      setBoth("sorrow", "sad", 0)
      setBoth("angry", "angry", 0)
      setBoth("fun", "relaxed", 0)
      setBoth("neutral", "neutral", 0)
      setBoth("a", "aa", 0)
      setBoth("e", "ee", 0)
      setBoth("o", "oh", 0)

      // Procedural Blinking (Handled purely in 3D loop for guaranteed performance)
      // Uses the scene's userData to persist state across frames without React re-renders
      if (vrm.scene.userData.blinkTimer === undefined) {
        vrm.scene.userData.blinkTimer = 0
        vrm.scene.userData.blinkState = 0 // 0=open, 1=closing, 2=opening
        vrm.scene.userData.blinkValue = 0
      }
      
      const ud = vrm.scene.userData
      ud.blinkTimer += delta
      
      if (ud.blinkState === 0 && ud.blinkTimer > 2.5 + Math.random() * 2) {
        // Trigger blink every ~2.5 - 4.5 seconds
        if (Math.random() > 0.1) ud.blinkState = 1 // 90% chance to blink
        ud.blinkTimer = 0
      }

      if (ud.blinkState === 1) {
        ud.blinkValue += delta * 15 // Close fast
        if (ud.blinkValue >= 1) {
          ud.blinkValue = 1
          ud.blinkState = 2
        }
      } else if (ud.blinkState === 2) {
        ud.blinkValue -= delta * 10 // Open slightly slower
        if (ud.blinkValue <= 0) {
          ud.blinkValue = 0
          ud.blinkState = 0
          ud.blinkTimer = 0
        }
      }

      setBoth("blink", "blink", ud.blinkValue)

      // Apply lip sync (simple simulation mapping to vowels)
      if (isSpeaking && !isBlinking) {
        const mouthOpen = Math.max(0, Math.sin(t * 25)) * 0.8
        const vowelType = Math.floor((t * 5) % 3)
        if (vowelType === 0) setBoth("a", "aa", mouthOpen)
        else if (vowelType === 1) setBoth("e", "ee", mouthOpen)
        else setBoth("o", "oh", mouthOpen)
      }

      // Apply emotion (use "fun"/"relaxed" for happy so eyes stay open during conversation)
      if (emotion === "happy") setBoth("fun", "relaxed", 0.7)
      else if (emotion === "sad") setBoth("sorrow", "sad", 0.6)
      else if (emotion === "thoughtful" || emotion === "curious") setBoth("neutral", "neutral", 0.8)
      else if (emotion === "excited") setBoth("joy", "happy", 0.5) // Squint slightly only when fully excited
      else setBoth("neutral", "neutral", 0.5) // Default slight neutral expression
      
      // Additional expression overrides
      if (expression?.cheekGlow) {
        setBoth("joy", "happy", (exp.getValue("joy") || exp.getValue("happy") || 0) + expression.cheekGlow)
      }
    }
  })

  if (!vrm) return null

  return (
    <group position={[0, -0.1, 0]}>
      <primitive object={vrm.scene} />
    </group>
  )
}

export default function AvatarCanvas(props: AvatarCanvasProps) {
  // Use CuteGirl.vrm by default for this phase
  const modelUrl = props.modelUrl && props.modelUrl !== "/model.glb" && props.modelUrl !== "/face.glb" 
    ? props.modelUrl 
    : "/CuteGirl.vrm"

  return (
    <div className="absolute inset-0 w-full h-full">
      <div className="w-full h-full">
        <CanvasErrorBoundary>
          {/* Framed to show head, shoulders, and upper chest (crops out awkward T-pose arms) */}
          <Canvas camera={{ fov: 25, position: [0, 1.42, 0.95] }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
            <ambientLight intensity={1.0} />
            <directionalLight position={[1, 1, 1]} intensity={2.0} />
            <directionalLight position={[-1, 0, -1]} intensity={0.5} color="#abcdef" />
            <Environment preset="city" />
            
            <VrmModel {...props} modelUrl={modelUrl} />
            
            <OrbitControls enableZoom={false} enablePan={false} target={[0, 1.35, 0]} maxPolarAngle={Math.PI / 1.8} minPolarAngle={Math.PI / 3} />
          </Canvas>
        </CanvasErrorBoundary>
      </div>
    </div>
  )
}

