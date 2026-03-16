import * as Cesium from "cesium";

/**
 * 将经纬度转换为笛卡尔坐标
 * @param lng 经度
 * @param lat 纬度
 * @param height 高度
 * @returns 笛卡尔坐标
 */
export function getCartesian3FromDegrees(lng: number, lat: number, height: number): Cesium.Cartesian3 {
  const cartesian = Cesium.Cartesian3.fromDegrees(lng, lat, height);
  console.log(cartesian.x, cartesian.y, cartesian.z); // 输出笛卡尔坐标
  return cartesian;
}

/**
 * 将笛卡尔坐标转换为经纬度
 * @param cartesian 笛卡尔坐标
 * @returns 经纬度
 */
export function getDegreesFromCartesian3(cartesian: Cesium.Cartesian3): { lng: number, lat: number, height: number } {
  const { x, y, z } = cartesian;
  const lng = Cesium.Math.toRadians(x);
  const lat = Cesium.Math.toRadians(y);
  const height = z;
  return { lng, lat, height };
}



/**图片转为base64
 * @param imgUrl 图片url
 * @returns base64
 */
export async function imgToBase64(imgUrl: string): Promise<string> {
  const url = String(imgUrl || "").trim();
  if (!url) throw new Error("imgToBase64: imgUrl is empty");
  // 已经是 dataURL 直接返回
  if (/^data:/i.test(url)) return url;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`imgToBase64: failed to fetch ${url} (${resp.status})`);
  }
  const blob = await resp.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("imgToBase64: FileReader failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

/**base64转为图片   
 * @param base64 base64
 * @returns 图片
 */
export function base64ToImg(base64: string): string {
  const img = new Image();
  img.src = base64;
  return img.src;
}