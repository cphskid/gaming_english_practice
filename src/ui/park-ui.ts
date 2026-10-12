// 從樂園搬來的介面零件（public/ui-park/，原圖在樂園 repo 的 img/ui/）。
// 守護異世界的版面要跟樂園長得像同一個地方：同一片海、同一塊木牌、同一套按鈕。
const base = import.meta.env.BASE_URL
export const ui = (k: string) => `${base}ui-park/${k}.webp`.replace(/([^:])\/{2,}/g, '$1/')
