'use client';

import { FileText, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';

export default function UploadPanel({ onUploadComplete }: { onUploadComplete?: () => void }) {
    const [dragging, setDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [progress, setProgress] = useState<string>('');
    const [result, setResult] = useState<any>(null);
    const [syncResult, setSyncResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (selectedFile: File) => {
        setFile(selectedFile);
        setResult(null);
        setError(null);
        setProgress('');
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        setError(null);
        setResult(null);
        setProgress('Uploading file...');

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/supportplane/transcripts/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || data.message || 'Upload failed');
                setProgress('');
            } else {
                setResult(data);
                setFile(null);
                if (inputRef.current) inputRef.current.value = '';
                setProgress('');
                if (onUploadComplete) {
                    onUploadComplete();
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
            setProgress('');
        } finally {
            setUploading(false);
        }
    };

    const handleSharePointSync = async () => {
        setSyncing(true);
        setSyncError(null);
        setSyncResult(null);
        setProgress('Syncing from SharePoint...');

        try {
            const response = await fetch('/api/supportplane/transcripts/sync-sharepoint', {
                method: 'POST',
            });

            const data = await response.json();

            if (!response.ok) {
                setSyncError(data.error || data.message || 'Sync failed');
                setProgress('');
            } else {
                setSyncResult(data);
                setProgress('');
            }
        } catch (err) {
            setSyncError(err instanceof Error ? err.message : 'Sync failed');
            setProgress('');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div><div className={sp.panelTitle}>Upload L1 Transcripts</div><div className={sp.panelSubtitle}>.xlsx · .csv up to 50 MB each</div></div>
                <button
                    onClick={handleSharePointSync}
                    disabled={syncing || uploading}
                    className={`${sp.btn} ${sp.btnSecondary}`}
                    style={{marginLeft: 'auto'}}
                >
                    {syncing ? 'Syncing...' : 'Sync from SharePoint'}
                </button>
            </div>
            <div className={`${sp.uploadZone} ${dragging ? sp.uploadZoneActive : ''}`}
                onDragOver={(e)=>{e.preventDefault();setDragging(true);}}
                onDragLeave={()=>setDragging(false)}
                onDrop={(e)=>{
                    e.preventDefault();
                    setDragging(false);
                    if(e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]!);
                }}
                onClick={()=>inputRef.current?.click()}>
                <div className={sp.uploadIcon}><Upload size={32} /></div>
                <div className={sp.uploadTitle}>Drop file here or click to browse</div>
                <div className={sp.uploadSub}>Supports .xlsx · .csv</div>
                <input ref={inputRef} type="file" accept=".xlsx,.csv" style={{display:'none'}}
                    onChange={(e)=>{if(e.target.files?.[0]) handleFileSelect(e.target.files[0]);}} />
            </div>

            {file && !result && (
                <div className={sp.fileList}>
                    <div className={sp.fileRow}>
                        <FileText size={15} style={{color:'var(--sp-txm)'}} />
                        <span className={sp.fileName}>{file.name}</span>
                        <span className={sp.fileSize}>{(file.size/1024).toFixed(1)} KB</span>
                        <button onClick={handleUpload} disabled={uploading} className={`${sp.btn} ${sp.btnPrimary}`}>
                            {uploading ? 'Processing...' : 'Upload'}
                        </button>
                    </div>
                </div>
            )}

            {progress && (
                <div style={{marginTop:16,padding:12,background:'#0891b21a',border:'1px solid #0891b230',borderRadius:6,fontSize:12,color:'#0891b2',display:'flex',alignItems:'center',gap:8}}>
                    <div style={{width:12,height:12,border:'2px solid #0891b2',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 1s linear infinite'}} />
                    {progress}
                </div>
            )}

            {error && (
                <div className={sp.demoBanner} style={{marginTop:16,background:'#ef44441a',borderColor:'#ef444430'}}>
                    <span className={sp.demoBadge} style={{background:'#ef44441a',color:'#ef4444',borderColor:'#ef444440'}}>Error</span>
                    {error}
                </div>
            )}

            {syncError && (
                <div className={sp.demoBanner} style={{marginTop:16,background:'#ef44441a',borderColor:'#ef444430'}}>
                    <span className={sp.demoBadge} style={{background:'#ef44441a',color:'#ef4444',borderColor:'#ef444440'}}>Sync Error</span>
                    {syncError}
                </div>
            )}

            {result && (
                <div className={sp.demoBanner} style={{marginTop:16,background:'#10b9811a',borderColor:'#10b98130'}}>
                    <span className={sp.demoBadge} style={{background:'#10b9811a',color:'#10b981',borderColor:'#10b98140'}}>✓ Success</span>
                    <div style={{fontSize:12,marginTop:8}}>
                        <div><strong>Upload ID:</strong> {result.upload_id}</div>
                        <div><strong>Rows Processed:</strong> {result.rows?.processed} / {result.rows?.total}</div>
                        {result.rows?.errors > 0 && <div style={{color:'#f59e0b'}}><strong>Errors:</strong> {result.rows.errors}</div>}
                        {result.ai_tagging && <div style={{marginTop:4}}><strong>AI Tagging:</strong> {result.ai_tagging.message}</div>}
                    </div>
                </div>
            )}

            {syncResult && (
                <div className={sp.demoBanner} style={{marginTop:16,background:'#10b9811a',borderColor:'#10b98130'}}>
                    <span className={sp.demoBadge} style={{background:'#10b9811a',color:'#10b981',borderColor:'#10b98140'}}>✓ SharePoint Sync</span>
                    <div style={{fontSize:12,marginTop:8}}>
                        <div><strong>Files Found:</strong> {syncResult.files_found}</div>
                        <div><strong>Files Processed:</strong> {syncResult.files_processed}</div>
                        <div><strong>Files Skipped:</strong> {syncResult.files_skipped} (already uploaded)</div>
                        <div><strong>New Rows:</strong> {syncResult.total_new_rows}</div>
                        {syncResult.errors && syncResult.errors.length > 0 && (
                            <div style={{marginTop:8,color:'#f59e0b'}}>
                                <strong>Errors:</strong>
                                <ul style={{paddingLeft:20,margin:'4px 0'}}>
                                    {syncResult.errors.map((e: any, i: number) => (
                                        <li key={i}>{e.file}: {e.error}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className={sp.card} style={{marginTop:20}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>📋 Instructions</div>
                <ul style={{fontSize:12,color:'var(--sp-tx2)',paddingLeft:20,lineHeight:1.6}}>
                    <li>Accepts .xlsx or .csv format with 34-column structure</li>
                    <li>Maximum file size: 50 MB</li>
                    <li>Pre/post upload database backups created automatically in S3</li>
                    <li>AI tagging runs automatically using GoCode (Claude Opus 4.6)</li>
                    <li>Duplicate uploads allowed — DB handles idempotency via interaction_id</li>
                </ul>
            </div>
        </div>
    );
}
