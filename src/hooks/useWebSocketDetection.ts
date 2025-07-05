import { useCallback, useEffect, useRef, useState } from 'react';

interface Detection {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
}

interface UseWebSocketDetectionProps {
  cameraId: number;
  enabled: boolean;
  onDetectionUpdate: (predictions: Detection[]) => void;
  confidenceThreshold: number;
  overlapThreshold: number;
}

export const useWebSocketDetection = ({
  cameraId,
  enabled,
  onDetectionUpdate,
  confidenceThreshold,
  overlapThreshold
}: UseWebSocketDetectionProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string>("");
  const [processingTime, setProcessingTime] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [recentDetections, setRecentDetections] = useState<{ detection: Detection; timestamp: number }[]>([]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const clientId = `camera_${cameraId}_${Date.now()}`;
      const ws = new WebSocket(`ws://localhost:8000/ws/${clientId}`);
      
      ws.onopen = () => {
        console.log(`WebSocket connected for camera ${cameraId}`);
        setIsConnected(true);
        setConnectionError("");
        
        // Send ping to keep connection alive
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'detection_result') {
            if (data.success && data.predictions) {
              const now = Date.now();
              const updatedDetections = [...recentDetections];

              data.predictions.forEach((pred: Detection) => {
                const existing = updatedDetections.find(
                  (item) =>
                    item.detection.class === pred.class &&
                    Math.abs(item.detection.x - pred.x) < 15 &&
                    Math.abs(item.detection.y - pred.y) < 15
                );

                if (existing) {
                  existing.detection = pred;
                  existing.timestamp = now;
                } else {
                  updatedDetections.push({ detection: pred, timestamp: now });
                }
              });

              // Filter out old detections (older than 8 seconds)
              const filtered = updatedDetections.filter(item => now - item.timestamp <= 8000);
              setRecentDetections(filtered);
              onDetectionUpdate(filtered.map(d => d.detection));
              setProcessingTime(data.processing_time || 0);
            }
          } else if (data.type === 'pong') {
            // Handle pong response
            console.log('WebSocket pong received');
          } else if (data.type === 'error') {
            console.error('WebSocket detection error:', data.message);
            setConnectionError(data.message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log(`WebSocket disconnected for camera ${cameraId}`);
        setIsConnected(false);
        
        // Auto-reconnect if detection is still enabled
        if (enabled) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 2000);
        }
      };

      ws.onerror = (error) => {
        console.error(`WebSocket error for camera ${cameraId}:`, error);
        setConnectionError("WebSocket connection failed");
        setIsConnected(false);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionError("Failed to create WebSocket connection");
    }
  }, [cameraId, enabled, onDetectionUpdate, recentDetections]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setRecentDetections([]);
  }, []);

  const sendFrame = useCallback((imageData: string, originalWidth: number, originalHeight: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = {
        type: 'detection_frame',
        image: imageData,
        confidence_threshold: confidenceThreshold,
        overlap_threshold: overlapThreshold,
        original_width: originalWidth,
        original_height: originalHeight,
        road_id: cameraId
      };
      
      wsRef.current.send(JSON.stringify(message));
    }
  }, [cameraId, confidenceThreshold, overlapThreshold]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    isConnected,
    connectionError,
    processingTime,
    recentDetections: recentDetections.map(d => d.detection),
    sendFrame
  };
};
