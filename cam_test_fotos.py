#!/usr/bin/env python3
# capturar_fotos_intervalo.py — Webcam + YOLOv11 (Ultralytics) en Windows
# Captura 3 fotos, espera 5 segundos y repite el ciclo

import os
import time
import cv2
from datetime import datetime
from ultralytics import YOLO

# ===================== CONFIG =====================
MODEL_PATH = "yolo11n.pt"  # Modelo YOLO
SAVE_DIR = "capturas"       # Carpeta donde guardar fotos
CAM_INDEX = 0               # Índice de cámara (0 = integrada)
WIDTH, HEIGHT = 640, 480    # Resolución
FPS = 30                     # FPS deseados
CONF_THRESHOLD = 0.25        # Confianza mínima detección
IMG_SIZE = 512                # Tamaño de entrada YOLO
# ==================================================

os.makedirs(SAVE_DIR, exist_ok=True)

def open_cam(index=0, w=640, h=480, fps=30):
    cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        raise RuntimeError(f"No pude abrir la cámara en index={index}")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    cap.set(cv2.CAP_PROP_FPS, fps)
    return cap

def timestamp():
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def main():
    print("[INFO] Inicializando YOLO...")
    model = YOLO(MODEL_PATH)
    cap = open_cam(CAM_INDEX, WIDTH, HEIGHT, FPS)

    print("[INFO] Presiona 'q' para salir.")
    cycle = 1

    while True:
        print(f"\n[INFO] Ciclo {cycle}: Capturando 3 fotos...")
        for i in range(3):
            ret, frame = cap.read()
            if not ret:
                print("[WARN] No se pudo capturar el frame.")
                continue

            # Detección con YOLO
            results = model(frame, conf=CONF_THRESHOLD, imgsz=IMG_SIZE)
            annotated = results[0].plot()

            # Guardar la imagen procesada
            filename = os.path.join(SAVE_DIR, f"foto_{timestamp()}_{i+1}.jpg")
            cv2.imwrite(filename, annotated)
            print(f"[OK] Guardada: {filename}")

            # Mostrar en pantalla
            cv2.imshow("YOLOv11 - Captura", annotated)

            # Salida rápida
            if cv2.waitKey(1) & 0xFF == ord('q'):
                cap.release()
                cv2.destroyAllWindows()
                return

            time.sleep(0.5)  # pequeña pausa entre las 3 capturas

        print("[INFO] Esperando 5 segundos antes de la siguiente tanda...")
        # Espera 5 segundos antes de la siguiente tanda
        for t in range(5, 0, -1):
            print(f"   > Reanudando en {t} seg", end="\r")
            time.sleep(1)

        cycle += 1

if __name__ == "__main__":
    main()
