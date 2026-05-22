"use client";

import type { AvatarExpression, GazeTarget } from "@/lib/avatar/avatarEngine";

/* ── SVG Coordinate Constants ─────────────────────────────── */

const FACE_CX = 100;
const FACE_CY = 125;
const FACE_RX = 68;
const FACE_RY = 82;

const EYE_Y = 112;
const LEFT_EYE_CX = 70;
const RIGHT_EYE_CX = 130;
const EYE_RX = 16;
const EYE_RY_MAX = 10;

const IRIS_R = 6.5;
const PUPIL_R_BASE = 3.2;

const MOUTH_CY = 157;
const MOUTH_HALF_WIDTH_MAX = 28;

const BROW_OFFSET_Y = -20;   // above eye center
const BROW_HALF_WIDTH = 17;

const CHEEK_R = 13;
const CHEEK_CX_LEFT = 56;
const CHEEK_CX_RIGHT = 144;
const CHEEK_CY = 138;

/* ── Props ────────────────────────────────────────────────── */

interface EvaFaceProps {
  expression: AvatarExpression;
  gaze: GazeTarget;
  isBlinking: boolean;
  isSpeaking: boolean;
  breatheScale: number;
  browDrift: number;
  headDrift: number;
}

/* ── Helpers ──────────────────────────────────────────────── */

function computeMouthPath(
  curve: number,
  openness: number,
  width: number,
): string {
  const halfW = MOUTH_HALF_WIDTH_MAX * Math.max(0.3, width);
  const startX = FACE_CX - halfW;
  const endX = FACE_CX + halfW;
  const y = MOUTH_CY;

  // Top lip curve: positive curve = smile (control point goes DOWN from endpoints)
  const topControlY = y + curve * 10;

  if (openness < 0.02) {
    // Closed mouth — single quadratic bezier
    return `M ${startX},${y} Q ${FACE_CX},${topControlY} ${endX},${y}`;
  }

  // Open mouth — two curves forming a lens shape
  const bottomControlY = y + Math.abs(curve) * 4 + openness * 14;
  return `M ${startX},${y} Q ${FACE_CX},${topControlY} ${endX},${y} Q ${FACE_CX},${bottomControlY} ${startX},${y}`;
}

function computeBrowPath(
  cx: number,
  angle: number,
  height: number,
  drift: number,
  isRight: boolean,
): string {
  const dir = isRight ? -1 : 1;
  const baseY = EYE_Y + BROW_OFFSET_Y - height * 6 + drift * 5;

  // Angle tilts the outer end of the brow
  const outerY = baseY + angle * 4 * dir;
  const innerY = baseY - angle * 2 * dir;

  const innerX = cx + BROW_HALF_WIDTH * dir * -1;
  const outerX = cx + BROW_HALF_WIDTH * dir;
  const controlX = cx;
  const controlY = Math.min(innerY, outerY) - 3;

  return `M ${innerX},${innerY} Q ${controlX},${controlY} ${outerX},${outerY}`;
}

/* ── Component ────────────────────────────────────────────── */

export function EvaFace({
  expression,
  gaze,
  isBlinking,
  isSpeaking,
  breatheScale,
  browDrift,
  headDrift,
}: EvaFaceProps) {
  const {
    eyeOpenness,
    pupilSize,
    browAngle,
    browHeight,
    mouthCurve,
    mouthOpenness,
    mouthWidth,
    cheekGlow,
    headTilt,
    irisHue,
  } = expression;

  // Compute derived values
  const effectiveEyeRy = isBlinking ? 0.5 : EYE_RY_MAX * Math.max(0.08, eyeOpenness);
  const pupilR = PUPIL_R_BASE * Math.max(0.3, pupilSize);
  const gazeOffsetX = gaze.x * 4;   // max 4px offset
  const gazeOffsetY = gaze.y * 2.5;  // max 2.5px offset
  const mouthPath = computeMouthPath(mouthCurve, mouthOpenness, mouthWidth);
  const totalHeadTilt = (headTilt + headDrift) * 3; // degrees

  const leftBrow = computeBrowPath(LEFT_EYE_CX, browAngle, browHeight, browDrift, false);
  const rightBrow = computeBrowPath(RIGHT_EYE_CX, browAngle, browHeight, browDrift, true);

  return (
    <svg
      className="eva-face-svg"
      viewBox="0 0 200 260"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="EVA avatar face"
      style={{
        transform: `scale(${breatheScale}) rotate(${totalHeadTilt}deg)`,
      }}
    >
      <defs>
        {/* Face gradient — ethereal, luminous on dark bg */}
        <radialGradient id="eva-face-fill" cx="45%" cy="38%" r="60%">
          <stop offset="0%" stopColor="rgba(180, 215, 245, 0.16)" />
          <stop offset="70%" stopColor="rgba(130, 170, 220, 0.09)" />
          <stop offset="100%" stopColor="rgba(100, 140, 190, 0.04)" />
        </radialGradient>

        {/* Ambient glow behind face */}
        <radialGradient id="eva-ambient-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={irisHue} stopOpacity="0.08" />
          <stop offset="100%" stopColor={irisHue} stopOpacity="0" />
        </radialGradient>

        {/* Iris glow */}
        <radialGradient id="eva-iris-glow" cx="40%" cy="35%">
          <stop offset="0%" stopColor={irisHue} stopOpacity="0.9" />
          <stop offset="70%" stopColor={irisHue} stopOpacity="0.6" />
          <stop offset="100%" stopColor={irisHue} stopOpacity="0.3" />
        </radialGradient>

        {/* Eye clip paths */}
        <clipPath id="eva-eye-clip-left">
          <ellipse cx={LEFT_EYE_CX} cy={EYE_Y} rx={EYE_RX + 1} ry={effectiveEyeRy + 0.5} />
        </clipPath>
        <clipPath id="eva-eye-clip-right">
          <ellipse cx={RIGHT_EYE_CX} cy={EYE_Y} rx={EYE_RX + 1} ry={effectiveEyeRy + 0.5} />
        </clipPath>
      </defs>

      {/* Ambient glow circle */}
      <circle
        cx={FACE_CX}
        cy={FACE_CY}
        r={FACE_RX + 30}
        fill="url(#eva-ambient-glow)"
        className={isSpeaking ? "eva-speaking-glow" : ""}
      />

      {/* Face shape */}
      <ellipse
        cx={FACE_CX}
        cy={FACE_CY}
        rx={FACE_RX}
        ry={FACE_RY}
        fill="url(#eva-face-fill)"
        stroke="rgba(131, 183, 255, 0.2)"
        strokeWidth="1"
      />

      {/* ── Left Eye ──────────────────────────────────────── */}
      <g clipPath="url(#eva-eye-clip-left)">
        {/* Eye white */}
        <ellipse
          cx={LEFT_EYE_CX}
          cy={EYE_Y}
          rx={EYE_RX}
          ry={EYE_RY_MAX}
          fill="rgba(215, 235, 255, 0.92)"
        />
        {/* Iris */}
        <circle
          cx={LEFT_EYE_CX + gazeOffsetX}
          cy={EYE_Y + gazeOffsetY}
          r={IRIS_R}
          fill="url(#eva-iris-glow)"
        />
        {/* Pupil */}
        <circle
          cx={LEFT_EYE_CX + gazeOffsetX}
          cy={EYE_Y + gazeOffsetY}
          r={pupilR}
          fill="#080e18"
        />
        {/* Highlight */}
        <circle
          cx={LEFT_EYE_CX + gazeOffsetX - 2}
          cy={EYE_Y + gazeOffsetY - 2}
          r={1.6}
          fill="rgba(255, 255, 255, 0.75)"
        />
      </g>
      {/* Eye outline (lash line) */}
      <ellipse
        cx={LEFT_EYE_CX}
        cy={EYE_Y}
        rx={EYE_RX}
        ry={effectiveEyeRy}
        fill="none"
        stroke="rgba(180, 210, 240, 0.45)"
        strokeWidth="1"
      />

      {/* ── Right Eye ─────────────────────────────────────── */}
      <g clipPath="url(#eva-eye-clip-right)">
        <ellipse
          cx={RIGHT_EYE_CX}
          cy={EYE_Y}
          rx={EYE_RX}
          ry={EYE_RY_MAX}
          fill="rgba(215, 235, 255, 0.92)"
        />
        <circle
          cx={RIGHT_EYE_CX + gazeOffsetX}
          cy={EYE_Y + gazeOffsetY}
          r={IRIS_R}
          fill="url(#eva-iris-glow)"
        />
        <circle
          cx={RIGHT_EYE_CX + gazeOffsetX}
          cy={EYE_Y + gazeOffsetY}
          r={pupilR}
          fill="#080e18"
        />
        <circle
          cx={RIGHT_EYE_CX + gazeOffsetX - 2}
          cy={EYE_Y + gazeOffsetY - 2}
          r={1.6}
          fill="rgba(255, 255, 255, 0.75)"
        />
      </g>
      <ellipse
        cx={RIGHT_EYE_CX}
        cy={EYE_Y}
        rx={EYE_RX}
        ry={effectiveEyeRy}
        fill="none"
        stroke="rgba(180, 210, 240, 0.45)"
        strokeWidth="1"
      />

      {/* ── Eyebrows ──────────────────────────────────────── */}
      <path
        d={leftBrow}
        fill="none"
        stroke="rgba(180, 210, 240, 0.55)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d={rightBrow}
        fill="none"
        stroke="rgba(180, 210, 240, 0.55)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      {/* ── Mouth ─────────────────────────────────────────── */}
      <path
        d={mouthPath}
        fill={mouthOpenness > 0.02 ? "rgba(80, 50, 60, 0.5)" : "none"}
        stroke="rgba(180, 210, 240, 0.5)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* ── Cheeks (blush glow) ───────────────────────────── */}
      {cheekGlow > 0.01 && (
        <>
          <circle
            cx={CHEEK_CX_LEFT}
            cy={CHEEK_CY}
            r={CHEEK_R}
            fill={irisHue}
            opacity={cheekGlow * 0.15}
          />
          <circle
            cx={CHEEK_CX_RIGHT}
            cy={CHEEK_CY}
            r={CHEEK_R}
            fill={irisHue}
            opacity={cheekGlow * 0.15}
          />
        </>
      )}
    </svg>
  );
}
