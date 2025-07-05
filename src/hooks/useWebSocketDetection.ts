
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
  const reconnectAttemptsRef = useRef<number>(0);
  const maxReconnectAttempts = 10;

  const connect = useCallback(() => {
    // Don't create new connection if one already exists and is connecting/open
    if (wsRef.current && 
        (wsRef.current.readyState === WebSocket.CONNECTING || 
         wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      const clientId = `camera_${cameraId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const wsUrl = `ws://localhost:8000/ws/${clientId}`;
      
      console.log(`[WebSocket] Attempting to connect to: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log(`[WebSocket] Connected successfully for camera ${cameraId}`);
        setIsConnected(true);
        setConnectionError("");
        reconnectAttemptsRef.current = 0;
        
        // Send initial ping to establish connection
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
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
                    Math.abs(item.detection.x - pred.x) < 20 &&
                    Math.abs(item.detection.y - pred.y) < 20
                );

                if (existing) {
                  existing.detection = pred;
                  existing.timestamp = now;
                } else {
                  updatedDetections.push({ detection: pred, timestamp: now });
                }
              });

              // Filter out old detections (older than 5 seconds)
              const filtered = updatedDetections.filter(item => now - item.timestamp <= 5000);
              setRecentDetections(filtered);
              onDetectionUpdate(filtered.map(d => d.detection));
              setProcessingTime(data.processing_time || 0);
            }
          } else if (data.type === 'pong') {
            console.log(`[WebSocket] Pong received for camera ${cameraId}`);
          } else if (data.type === 'error') {
            console.error(`[WebSocket] Server error for camera ${cameraId}:`, data.message);
            setConnectionError(data.message);
          }
        } catch (error) {
          console.error(`[WebSocket] Error parsing message for camera ${cameraId}:`, error);
        }
      };

      ws.onclose = (event) => {
        console.log(`[WebSocket] Connection closed for camera ${cameraId}. Code: ${event.code}, Reason: ${event.reason}`);
        setIsConnected(false);
        
        // Only attempt to reconnect if detection is still enabled and we haven't exceeded max attempts
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000); // Exponential backoff, max 10s
          console.log(`[WebSocket] Scheduling reconnection attempt ${reconnectAttemptsRef.current + 1} in ${delay}ms`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setConnectionError("Max reconnection attempts reached. Please refresh the page.");
        }
      };

      ws.onerror = (error) => {
        console.error(`[WebSocket] Connection error for camera ${cameraId}:`, error);
        setConnectionError("WebSocket connection failed - make sure backend is running");
        setIsConnected(false);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error(`[WebSocket] Failed to create connection for camera ${cameraId}:`, error);
      setConnectionError("Failed to create WebSocket connection");
    }
  }, [cameraId, enabled, onDetectionUpdate, recentDetections]);

  const disconnect = useCallback(() => {
    console.log(`[WebSocket] Disconnecting camera ${cameraId}`);
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setRecentDetections([]);
    reconnectAttemptsRef.current = 0;
  }, [cameraId]);

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
      
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (error) {
        console.error(`[WebSocket] Error sending frame for camera ${cameraId}:`, error);
        setConnectionError("Failed to send frame data");
      }
    } else {
      console.warn(`[WebSocket] Cannot send frame - connection not ready for camera ${cameraId}`);
    }
  }, [cameraId, confidenceThreshold, overlapThreshold]);

  // Force reconnect function
  const forceReconnect = useCallback(() => {
    console.log(`[WebSocket] Force reconnecting camera ${cameraId}`);
    disconnect();
    reconnectAttemptsRef.current = 0;
    setTimeout(() => {
      if (enabled) {
        connect();
      }
    }, 1000);
  }, [enabled, connect, disconnect, cameraId]);

  useEffect(() => {
    if (enabled) {
      console.log(`[WebSocket] Starting connection for camera ${cameraId}`);
      connect();
    } else {
      console.log(`[WebSocket] Stopping connection for camera ${cameraId}`);
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
    sendFrame,
    forceReconnect
  };
};
