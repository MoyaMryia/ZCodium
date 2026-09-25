/** Stateless target resolution over the surface owner's latest window observation. */
export function staleTarget(message = "Target has no current observation; observe the app again") {
  return Object.assign(new Error(message), { code: "STALE_STATE" });
}

function pixelTarget(x, y, observation, frameId) {
  if (!observation?.raster || (frameId !== undefined && frameId !== observation.frameId)) {
    throw staleTarget("Screenshot is missing or stale; get a fresh screenshot before using pixels");
  }
  const { width, height } = observation.raster;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw staleTarget("Target pixels are outside the observed screenshot");
  }
  return { x, y };
}

export function resolveSurfaceTarget(target, observation, { coordinatesOnly = false } = {}) {
  // 修复：技能 SDK 的 wire target 是对象，不能按旧 number/array 契约忽略或误投递。
  const point =
    Array.isArray(target) && target.length === 2
      ? { x: target[0], y: target[1] }
      : target?.type === "coordinate"
        ? target
        : undefined;
  if (point) return pixelTarget(point.x, point.y, observation, point.frame_id);
  const index =
    typeof target === "number" ? target : target?.type === "element" ? target.index : undefined;
  if (!Number.isInteger(index) || index < 0)
    throw staleTarget("Target must identify an observed element or screenshot pixel");
  if (target?.state_id !== undefined && target.state_id !== observation?.stateId)
    throw staleTarget();
  const element = observation?.byIndex.get(index);
  if (!element?.element_token) throw staleTarget();
  if (!coordinatesOnly) return { element_index: index, element_token: element.element_token };

  // cua-driver 的 drag 只接受像素端点，没有 from_element_token/to_element_token。
  // 元素几何来自同一张观测，不能重查后悄悄把旧索引绑定到另一个元素。
  const frame = element.frame;
  const origin = observation?.raster?.origin;
  if (
    !frame ||
    !origin ||
    ![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) ||
    frame.w <= 0 ||
    frame.h <= 0
  ) {
    throw staleTarget("Element has no usable screenshot geometry for dragging");
  }
  return pixelTarget(
    // AT-SPI/UIA 元素框是屏幕坐标，drag 入口要求窗口坐标；不能隐含窗口在 (0, 0)。
    Math.floor(frame.x - origin.x + frame.w / 2),
    Math.floor(frame.y - origin.y + frame.h / 2),
    observation,
  );
}

export function screenshotRaster(raw, structured) {
  if (!raw?.images?.length) return undefined;
  const width = structured.screenshot_width;
  const height = structured.screenshot_height;
  const bounds = structured.window_bounds;
  const origin =
    bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      ? { x: bounds.x, y: bounds.y }
      : undefined;
  // 只能用真实 raster metadata，不能用窗口 bounds 冒充高 DPI 图像尺寸。
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { width, height, origin }
    : undefined;
}
