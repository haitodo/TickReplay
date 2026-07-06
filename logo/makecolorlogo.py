import cv2
import numpy as np

def get_bezier_points(p0, p1, p2, p3, num_pts=300):
    """ベジェ曲線の構成点を細かくサンプリングする関数"""
    t = np.linspace(0, 1, num_pts)[:, None]
    pts = (1-t)**3 * p0 + 3*(1-t)**2*t * p1 + 3*(1-t)*t**2 * p2 + t**3 * p3
    return pts

def create_colored_image(target_size=1024, margin_ratio=0.08, 
                         color_green=(157, 201, 56, 255),    # BGRA (黄緑: #9dc938)
                         color_cyan=(198, 191, 68, 255),    # BGRA (水色: #44bfc6)
                         color_magenta=(130, 39, 192, 255), # BGRA (マゼンタ: #c02782)
                         color_yellow=(22, 203, 253, 255),  # BGRA (黄色: #fdcb16)
                         color_arrow=(114, 47, 24, 255),    # BGRA (紺矢印: #182f72)
                         color_bg=(255, 255, 255, 255),     # BGRA (背景)
                         transparent_bg=False):
    """
    リアルタイムカラー確認ツールと同等の処理をPythonで行う関数。
    パーツ自動検出により、各セグメントに個別のカラーを割り当ててアイコンを生成します。
    """
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
    
    # ★★★ 技術的修正: すべての接合部（全10箇所の頂点）に半径46pxの塗りつぶし円を描画します ★★★
    # これにより、HTMLツール（SVG）の「stroke-linejoin="round"」と同等の滑らかな角丸マスク処理をOpenCVでも実現します。
    for pt in arrow_poly:
        cv2.circle(mask, (int(pt[0]), int(pt[1])), 46, 0, -1, lineType=cv2.LINE_AA)
    
    # --- 2. 波全体のグレースケール下絵を描画 (255: 波の本体) ---
    wave_gray = np.zeros((height, width), dtype=np.uint8)
    
    pts_list = []
    pts_list.append(np.array([[473, 1496], [473, 1420]]))
    pts_list.append(get_bezier_points(np.array([473, 1420]), np.array([473, 1353]), np.array([475, 1237]), np.array([571, 1237])))
    pts_list.append(get_bezier_points(np.array([571, 1237]), np.array([654, 1237]), np.array([638, 1430]), np.array([716, 1430])))
    pts_list.append(get_bezier_points(np.array([716, 1430]), np.array([821, 1430]), np.array([789, 720]), np.array([905, 720])))
    pts_list.append(get_bezier_points(np.array([905, 720]), np.array([985, 720]), np.array([966, 1252]), np.array([1046, 1252])))
    pts_list.append(get_bezier_points(np.array([1046, 1252]), np.array([1126, 1252]), np.array([1187, 807]), np.array([1187, 727])))
    
    # 階段部分
    pts_stair = np.array([
        [1187, 727], [1324, 727], [1324, 615], [1461, 615], [1461, 447]
    ])
    
    # 描画パラメータ
    thickness = 107
    radius = thickness // 2
    
    all_pts = []
    for pts in pts_list:
        all_pts.extend(pts.astype(np.int32))
    all_pts.extend(pts_stair)
    
    round_corners = [
        all_pts[0], all_pts[-1], [1187, 727], [1324, 727], [1324, 615], [1461, 615]
    ]
    for pt in round_corners:
        cv2.circle(wave_gray, (int(pt[0]), int(pt[1])), radius, 255, -1, lineType=cv2.LINE_AA)
        
    cv2.polylines(wave_gray, [np.array(all_pts, dtype=np.int32)], False, 255, thickness, lineType=cv2.LINE_AA)
    
    # マスクを適用して物理的に4つに分断
    masked_wave_gray = cv2.bitwise_and(wave_gray, mask)
    
    # --- 3. 連結成分検出により4つのパーツに分離し彩色 ---
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(masked_wave_gray)
    
    # 背景以外の各パーツ（ラベル1〜4）をリスト化
    parts = []
    for i in range(1, num_labels):
        parts.append({
            'label_id': i,
            'centroid_x': centroids[i][0]
        })
    
    # 重心のX座標（左から右）の順にソート
    parts = sorted(parts, key=lambda x: x['centroid_x'])
    
    # ソート順に適用する4色の配列
    target_colors = [color_green, color_cyan, color_magenta, color_yellow]
    
    wave_canvas = np.zeros((height, width, 4), dtype=np.uint8)
    
    for idx, part in enumerate(parts):
        label_id = part['label_id']
        col = target_colors[idx]
        
        # 該当パーツ部分のみを抽出する二値マスク
        part_mask = (labels == label_id)
        
        # 滑らかな境界を維持するため、描画データのアルファ値（透過度）を適用
        part_alpha = (masked_wave_gray.astype(float) * (col[3] / 255.0)).astype(np.uint8)
        
        # カラーとアルファ情報を統合キャンバスに適用
        wave_canvas[part_mask, :3] = col[:3]
        wave_canvas[part_mask, 3] = part_alpha[part_mask]

    # --- 4. 矢印を描画 ---
    arrow_canvas = np.zeros((height, width, 4), dtype=np.uint8)
    cv2.fillPoly(arrow_canvas, [arrow_poly], color_arrow, lineType=cv2.LINE_AA)
    cv2.polylines(arrow_canvas, [arrow_poly], True, color_arrow, 1, lineType=cv2.LINE_AA)
    
    # --- 5. 正確にアルファブレンド（透過重ね合わせ） ---
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

    final_img = alpha_blend(final_img, wave_canvas)
    final_img = alpha_blend(final_img, arrow_canvas)
    
    # --- 6. 自動クロップ & 余白を考慮したリサイズ ---
    coords = cv2.findNonZero(final_img[:, :, 3])
    if coords is not None:
        x, y, w, h = cv2.boundingRect(coords)
        cropped_img = final_img[y:y+h, x:x+w]
        
        content_ratio = 1.0 - (margin_ratio * 2)
        scale = (target_size * content_ratio) / max(w, h)
        new_w = int(w * scale)
        new_h = int(h * scale)
        
        resized_img = cv2.resize(cropped_img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        
        # 新しいキャンバスを用意
        app_icon = np.zeros((target_size, target_size, 4), dtype=np.uint8)
        if not transparent_bg:
            app_icon[:, :] = color_bg
            
        start_x = (target_size - new_w) // 2
        start_y = (target_size - new_h) // 2
        
        # 重ね合わせ
        target_roi = app_icon[start_y:start_y+new_h, start_x:start_x+new_w]
        app_icon[start_y:start_y+new_h, start_x:start_x+new_w] = alpha_blend(target_roi, resized_img)
        
        output_filename = f"colored_app_icon_{target_size}.png"
        cv2.imwrite(output_filename, app_icon)
        print(f"アイコン画像 '{output_filename}' を出力しました（サイズ: {target_size}x{target_size}）。")
    else:
        cv2.imwrite("output.png", final_img)
        print("画像 'output.png' を出力しました。")

if __name__ == "__main__":
    # 添付画像の色味を割り当てて出力
    create_colored_image(
        target_size=1024,
        margin_ratio=0.08,
        color_green=(56, 201, 157, 255),    # 黄緑 (HEX: #9dc938)
        color_cyan=(198, 191, 68, 255),    # 水色 (HEX: #44bfc6)
        color_magenta=(130, 39, 192, 255), # ピンク (HEX: #c02782)
        color_yellow=(22, 203, 253, 255),  # 黄色 (HEX: #fdcb16)
        color_arrow=(114, 47, 24, 255),    # 紺矢印 (HEX: #182f72)
        color_bg=(255, 255, 255, 255),     # 白背景
        transparent_bg=False                # 背景を透過させたい場合はTrue
    )