#!/usr/bin/env python3
# yolo_cam_win.py — Webcam + YOLOv11 (Ultralytics) en Windows

import os, time, argparse
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")  # silencia logs de OpenCV

import cv2
from ultralytics import YOLO

def draw_fps(img, fps):
    txt = f"{fps:.1f} FPS"
    org = (12, 32)
    cv2.rectangle(img, (8, 8), (130, 40), (0, 0, 0), -1)
    cv2.putText(img, txt, org, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255,255,255), 2, cv2.LINE_AA)

def open_cam(index=0, w=640, h=480, fps=30):
    # Usamos AUTO porque te funcionó así
    cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        raise RuntimeError(f"No pude abrir la cámara en index={index} (AUTO)")
    # Fijar resolución/FPS (si el driver lo permite)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    cap.set(cv2.CAP_PROP_FPS,          fps)
    return cap

def main():
    ap = argparse.ArgumentParser(description="Webcam + YOLOv11")
    ap.add_argument("--model", type=str, default="yolo11n.pt", help="Ruta o alias del modelo YOLOv11 (ej. yolo11n.pt)")
    ap.add_argument("--index", type=int, default=0, help="Índice de cámara (default 0)")
    ap.add_argument("--w", type=int, default=640, help="Ancho deseado")
    ap.add_argument("--h", type=int, default=480,  help="Alto deseado")
    ap.add_argument("--fps", type=int, default=30, help="FPS deseados")
    ap.add_argument("--conf", type=float, default=0.25, help="Confianza mínima detección")
    ap.add_argument("--imgsz", type=int, default=512, help="Tamaño de inferencia (imgsz)")
    ap.add_argument("--classes", type=str, default="", help="Filtro de clases (ej: '0,2' o 'person,car')")
    ap.add_argument("--device", type=str, default=None, help="Dispositivo (None=auto, 'cpu' o 'cuda:0')")
    ap.add_argument("--showlabels", action="store_true", help="Mostrar etiquetas y conf")
    args = ap.parse_args()

    # Cargar modelo
    print(f"[INFO] Cargando modelo YOLO: {args.model}")
    model = YOLO(args.model)

    # Procesar filtro de clases (admite índices o nombres)
    classes = None
    if args.classes.strip():
        # Si son números separados por coma -> lista de int
        if all(tok.strip().isdigit() for tok in args.classes.split(",")):
            classes = [int(tok) for tok in args.classes.split(",")]
        else:
            # Ultralytics acepta nombres; se pasan tal cual
            classes = [tok.strip() for tok in args.classes.split(",") if tok.strip()]

    # Abrir cámara
    cap = open_cam(args.index, args.w, args.h, args.fps)

    # Loop
    t0 = time.time()
    frames = 0
    print("[INFO] Presiona 'q' para salir.")
    while True:
        ok, frame = cap.read()
        if not ok:
            print("[WARN] No llega frame (¿ocupada/desconectada?).")
            break

        # Inferencia (stream=True devuelve generador; más eficiente)
        results_gen = model(
            frame,
            stream=True,
            imgsz=args.imgsz,
            conf=args.conf,
            classes=classes,
            device=args.device  # None=auto
        )

        # results_gen suele tener un único elemento para un solo frame
        annotated = frame
        for r in results_gen:
            # Dibujar cajas en el propio resultado
            annotated = r.plot(labels=args.showlabels)  # r.plot() devuelve imagen con cajas/labels
            break  # solo uno

        # FPS
        frames += 1
        dt = time.time() - t0
        fps = frames / dt if dt > 0 else 0.0
        draw_fps(annotated, fps)

        cv2.imshow("YOLOv11 - Webcam", annotated)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
