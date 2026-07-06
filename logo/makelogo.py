import cv2
import numpy as np

def get_bezier_points(p0, p1, p2, p3, num_pts=300):
    """ベジェ曲線の構成点を細かくサンプリングする関数"""
    t = np.linspace(0, 1, num_pts)[:, None]
    pts = (1-t)**3 * p0 + 3*(1-t)**2*t * p1 + 3*(1-t)*t**2 * p2 + t**3 * p3
    return pts

def create_image(target_size=1024, margin_ratio=0.08):
    """
    画像を生成し、コンテンツ領域を自動検出・縮小して適切なアプリアイコンサイズに調整する関数
    
    Parameters:
        target_size (int): 出力する正方形アイコンの1辺のピクセル数 (1024, 512, 256など)
        margin_ratio (float): アイコン全体のサイズに対する余白（片側）の比率。
                             0.08の場合、左右上下にそれぞれ約8%の余白を設けます。
    """
    # 2000x2000ピクセルのキャンバス（高解像度で下絵を描画）
    width, height = 2000, 2000
    
    # --- 1. 隙間をくり抜くためのマスク (0: 透明, 255: 不透明) ---
    mask = np.ones((height, width), dtype=np.uint8) * 255
    arrow_poly = np.array([
        [414, 1000], [654, 843], [639, 941], [1361, 941], [1346, 843],
        [1586, 1000], [1346, 1157], [1361, 1059], [639, 1059], [654, 1157]
    ], dtype=np.int32)
    
    # 矢印本体と、周囲92pxの太さのストローク部分を黒(0)に設定
    cv2.fillPoly(mask, [arrow_poly], 0, lineType=cv2.LINE_AA)
    cv2.polylines(mask, [arrow_poly], True, 0, 92, lineType=cv2.LINE_AA)
    
    # --- 2. 緑色の連続するオブジェクトを描画 ---
    green_canvas = np.zeros((height, width, 4), dtype=np.uint8)
    col_green = (107, 162, 15, 255) # BGRA (RGB: 15, 162, 107)
    
    # 各セグメント（直線・ベジェ曲線・階段）の座標
    pts_list = []
    
    # 開始直線（X座標「473」で統一）
    pts_list.append(np.array([[473, 1496], [473, 1420]]))
    
    # 5つの連続ベジェ曲線
    pts_list.append(get_bezier_points(np.array([473, 1420]), np.array([473, 1353]), np.array([475, 1237]), np.array([571, 1237])))
    pts_list.append(get_bezier_points(np.array([571, 1237]), np.array([654, 1237]), np.array([638, 1430]), np.array([716, 1430])))
    pts_list.append(get_bezier_points(np.array([716, 1430]), np.array([821, 1430]), np.array([789, 720]), np.array([905, 720])))
    
    # 谷の左側：(905, 720) から底 (1046, 1252) まで
    pts_list.append(get_bezier_points(np.array([905, 720]), np.array([985, 720]), np.array([966, 1252]), np.array([1046, 1252])))
    # 谷の右側：底 (1046, 1252) から階段の開始点 (1187, 727) まで
    pts_list.append(get_bezier_points(np.array([1046, 1252]), np.array([1126, 1252]), np.array([1187, 807]), np.array([1187, 727])))
    
    # 階段部分
    pts_stair = np.array([
        [1187, 727], [1324, 727], [1324, 615], [1461, 615], [1461, 447]
    ])
    
    # 描画パラメータ（線幅107px、半径53px）
    thickness = 107
    radius = thickness // 2
    
    # すべての座標点を一つの配列に結合
    all_pts = []
    for pts in pts_list:
        all_pts.extend(pts.astype(np.int32))
    all_pts.extend(pts_stair)
    
    # 端点および「階段の急激な角」に丸を描画
    round_corners = [
        all_pts[0],   # 開始端点
        all_pts[-1],  # 終了端点
        [1187, 727],  # 階段の角1
        [1324, 727],  # 階段の角2
        [1324, 615],  # 階段の角3
        [1461, 615]   # 階段の角4
    ]
    for pt in round_corners:
        cv2.circle(green_canvas, (int(pt[0]), int(pt[1])), radius, col_green, -1, lineType=cv2.LINE_AA)
        
    cv2.polylines(green_canvas, [np.array(all_pts, dtype=np.int32)], False, col_green, thickness, lineType=cv2.LINE_AA)

    # 1で作成したマスクを緑色キャンバスのアルファ（透明度）に乗算し、矢印の隙間を綺麗に透過
    green_canvas[:, :, 3] = (green_canvas[:, :, 3] * (mask / 255.0)).astype(np.uint8)
    
    # --- 3. 矢印本体を描画 ---
    arrow_canvas = np.zeros((height, width, 4), dtype=np.uint8)
    col_orange = (31, 113, 254, 255) # BGRA (RGB: 254, 113, 31)
    
    cv2.fillPoly(arrow_canvas, [arrow_poly], col_orange, lineType=cv2.LINE_AA)
    cv2.polylines(arrow_canvas, [arrow_poly], True, col_orange, 1, lineType=cv2.LINE_AA)
    
    # --- 4. 正確にアルファブレンド（透過重ね合わせ） ---
    final_img = np.zeros((height, width, 4), dtype=np.uint8)
    
    def alpha_blend(background, foreground):
        fg_alpha = foreground[:, :, 3] / 255.0
        bg_alpha = background[:, :, 3] / 255.0
        out_alpha = fg_alpha + bg_alpha * (1.0 - fg_alpha)
        
        fg_alpha_factor = fg_alpha[:, :, None]
        bg_alpha_factor = bg_alpha[:, :, None] * (1.0 - fg_alpha[:, :, None])
        denom = out_alpha[:, :, None]
        denom = np.where(denom == 0, 1.0, denom)
        
        out_color = (foreground[:, :, :3] * fg_alpha_factor + background[:, :, :3] * bg_alpha_factor) / denom
        out_img = np.zeros_like(background)
        out_img[:, :, :3] = np.clip(out_color, 0, 255).astype(np.uint8)
        out_img[:, :, 3] = (out_alpha * 255).astype(np.uint8)
        return out_img

    final_img = alpha_blend(final_img, green_canvas)
    final_img = alpha_blend(final_img, arrow_canvas)
    
    # --- 5. 【追加】自動クロップ & 余白を考慮したリサイズ ---
    # アルファ（透明度）チャンネルから、実際に描画されているピクセルの最小・最大の境界を取得
    coords = cv2.findNonZero(final_img[:, :, 3])
    if coords is not None:
        x, y, w, h = cv2.boundingRect(coords)
        cropped_img = final_img[y:y+h, x:x+w]
        
        # コンテンツが占める割合の計算（1.0 - 左右の余白比率2個分）
        content_ratio = 1.0 - (margin_ratio * 2)
        
        # アスペクト比を維持して、指定の target_size に収まるスケールを決定
        scale = (target_size * content_ratio) / max(w, h)
        new_w = int(w * scale)
        new_h = int(h * scale)
        
        # 高品質に縮小リサイズ（cv2.INTER_AREA を使用してジャギーを抑える）
        resized_img = cv2.resize(cropped_img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        
        # target_size x target_size の透明な正方形キャンバスを作成して、中央に配置
        app_icon = np.zeros((target_size, target_size, 4), dtype=np.uint8)
        start_x = (target_size - new_w) // 2
        start_y = (target_size - new_h) // 2
        app_icon[start_y:start_y+new_h, start_x:start_x+new_w] = resized_img
        
        # 出力
        output_filename = f"app_icon_{target_size}.png"
        cv2.imwrite(output_filename, app_icon)
        print(f"アイコン画像 '{output_filename}' を出力しました（サイズ: {target_size}x{target_size}, 余白比率: {margin_ratio * 100:.1f}%）。")
    else:
        # 万が一不透明な要素が検出されない場合のフォールバック
        cv2.imwrite("output.png", final_img)
        print("画像 'output.png' を出力しました。")

if __name__ == "__main__":
    # WindowsやmacOSの最大推奨アイコンサイズ（1024x1024）で書き出し
    # 余白比率（margin_ratio）に 0.08（8%）を設定すると、OSのアイコン表示としてバランスの良い配置になります。
    create_image(target_size=1024, margin_ratio=0.08)