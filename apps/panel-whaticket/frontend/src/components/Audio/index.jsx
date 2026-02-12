import { Button } from "@material-ui/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../../services/api";

const LS_NAME = "audioMessageRate";

/**
 * Audio player that is resilient to CORS/mediaUrl origins.
 *
 * We fetch the audio as a blob through the authenticated API client and
 * play via an object URL. This avoids direct cross-origin streaming issues
 * (common with Evolution/MinIO/S3 URLs).
 */
export default function Audio({ url }) {
  const audioRef = useRef(null);
  const [audioRate, setAudioRate] = useState(
    parseFloat(localStorage.getItem(LS_NAME) || "1")
  );
  const [showButtonRate, setShowButtonRate] = useState(false);
  const [blobUrl, setBlobUrl] = useState("");

  const safeUrl = useMemo(() => (typeof url === "string" ? url : ""), [url]);

  useEffect(() => {
    if (!safeUrl) return;

    let revoked = false;
    let currentObjectUrl = "";

    const fetchAudio = async () => {
      try {
        const { data, headers } = await api.get(safeUrl, { responseType: "blob" });
        const type = headers?.["content-type"] || "audio/ogg";
        currentObjectUrl = window.URL.createObjectURL(new Blob([data], { type }));
        if (!revoked) setBlobUrl(currentObjectUrl);
      } catch {
        // Fallback to direct URL; might still work when CORS is ok.
        if (!revoked) setBlobUrl(safeUrl);
      }
    };

    fetchAudio();

    return () => {
      revoked = true;
      if (currentObjectUrl && currentObjectUrl.startsWith("blob:")) {
        window.URL.revokeObjectURL(currentObjectUrl);
      }
    };
  }, [safeUrl]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = audioRate;
    localStorage.setItem(LS_NAME, String(audioRate));
  }, [audioRate]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.onplaying = () => setShowButtonRate(true);
    audioRef.current.onpause = () => setShowButtonRate(false);
    audioRef.current.onended = () => setShowButtonRate(false);
  }, []);

  const toggleRate = () => {
    let newRate;
    switch (audioRate) {
      case 0.5:
        newRate = 1;
        break;
      case 1:
        newRate = 1.5;
        break;
      case 1.5:
        newRate = 2;
        break;
      case 2:
        newRate = 0.5;
        break;
      default:
        newRate = 1;
        break;
    }
    setAudioRate(newRate);
  };

  return (
    <>
      <audio ref={audioRef} controls preload="metadata">
        <source src={blobUrl || safeUrl} />
      </audio>
      {showButtonRate && (
        <Button
          style={{ marginLeft: "5px", marginTop: "-45px" }}
          onClick={toggleRate}
        >
          {audioRate}x
        </Button>
      )}
    </>
  );
}
