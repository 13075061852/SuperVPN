import React, { useId } from 'react';
import { Trash2 } from 'lucide-react';
import SourceEditor from './SourceEditor';

export default function SourceDetails({ target, data, busy, error, onAction, onClose }) {
  const formId = useId();
  const subscription = target.kind === 'subscription';
  const { item } = target;
  const canRemove = subscription || !item.subscriptionId;
  const connected = data.session.connected;
  const connectedEditing = (subscription ? data.environment?.connectedEditing : data.environment?.connectedNodeEditing) === true;
  const canRemoveWhileConnected = subscription ? connectedEditing : data.environment?.connectedNodeDeletion === true;
  const removeLocked = busy || (connected && !canRemoveWhileConnected);
  const removeLabel = subscription ? '移除订阅' : '删除节点链接';
  const editLocked = !subscription && data.testProgress?.running;

  async function removeSource() {
    if (await onAction(subscription ? 'deleteSubscription' : 'deleteNode', item.id)) onClose();
  }

  return <>
    <SourceEditor formId={formId} target={target} connected={connected} connectedEditing={connectedEditing} busy={busy} locked={editLocked}
      onSave={async (method, payload) => { if (await onAction(method, payload)) onClose(); }}/>
    {error && <p className="form-error source-edit-error" role="alert">{error}</p>}
    <div className="dialog-actions">
      {canRemove
        ? <button type="button" className="button quiet source-remove" disabled={removeLocked} onClick={removeSource}><Trash2 size={15} aria-hidden="true"/>{removeLabel}</button>
        : <button type="button" className="button quiet" disabled={busy} onClick={onClose}>取消</button>}
      <button type="submit" form={formId} className="button primary" disabled={busy || editLocked}>{busy ? '处理中…' : '保存'}</button>
    </div>
  </>;
}
