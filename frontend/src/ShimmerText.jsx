/**
 * ShimmerText — the supplied component's geometry, driven by CSS.
 *
 * The geometry is the part that matters and it is kept exactly: no-repeat with a band
 * half the element's width, so there is ONE highlight and it crosses from off-canvas
 * right to off-canvas left. A repeating background cannot show travel, because every
 * position looks like the one before it.
 *
 * What changed is the driver. motion does not interpolate `backgroundPositionX` - it
 * applies the final keyframe and stops - so the animation ran with nothing moving.
 * A CSS keyframe animates it correctly and runs on the compositor.
 */
export function ShimmerText({ children, as: Tag = "span", className = "", style, ...rest }) {
  return (
    <Tag className={`cf-shimmer ${className}`} style={style} {...rest}>{children}</Tag>
  );
}

