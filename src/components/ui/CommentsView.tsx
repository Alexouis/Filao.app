import React, { useState, useEffect, useRef } from 'react';
import { useToast } from './Toast';
import {
  X, Bold, Italic, Underline, Paperclip, Smile, Image as ImageIcon,
  AtSign, MessageSquare, MoreHorizontal, ChevronDown, ArrowUpDown,
  Loader2, Heart, Send, Edit2, Trash2, CheckCircle2
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { notifyCommentAdded } from '../../helpers/notificationHelpers';

interface Comment {
  id: string;
  tender_id: string;
  user_id: string;
  parent_comment_id: string | null;
  content: string;
  likes: string[];
  mentions: string[];
  attachments: string[];
  is_edited: boolean;
  edited_at: string | null;
  created_at: string;
  nom: string;
  prenom: string;
  photo_url: string | null;
  email: string;
  like_count: number;
  reply_count: number;
}

interface CommentsViewProps {
  tenderId: string;
  onClose: () => void;
}

export const CommentsView: React.FC<CommentsViewProps> = ({ tenderId, onClose }) => {
  const { showToast } = useToast();
  const [comments, setComments] = useState<Comment[]>([]);
  const [replies, setReplies] = useState<{ [key: string]: Comment[] }>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'likes'>('newest');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [tenderCollaborators, setTenderCollaborators] = useState<any[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchCurrentUser();
    fetchComments();
    fetchTenderCollaborators();
  }, [tenderId]);

  useEffect(() => {
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [newComment]);

  const fetchCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('utilisateurs')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setCurrentUser(data);
    } catch (error) {
      console.error('Error fetching user:', error);
    }
  };

  const fetchTenderCollaborators = async () => {
    try {
      // 1. Fetch from groupements (structured team)
      const { data: grpData } = await supabase
        .from('groupements')
        .select(`
          entreprise:entreprises (
            membres:utilisateurs (id)
          )
        `)
        .eq('projet_id', tenderId)
        .eq('statut', 'accepte');

      // 2. Fetch from invitations (pending or guests)
      const { data: invData } = await supabase
        .from('invitations')
        .select('email')
        .eq('tender_id', tenderId);

      // 3. Resolve invitations to user IDs if they exist
      const invEmails = invData?.map(i => i.email) || [];
      let invUserIds: string[] = [];
      if (invEmails.length > 0) {
        const { data: userData } = await supabase
          .from('utilisateurs')
          .select('id')
          .in('email', invEmails);
        invUserIds = userData?.map(u => u.id) || [];
      }

      // 4. Combine all unique IDs
      const grpUserIds = grpData?.flatMap(g => g.entreprise?.membres?.map((m: any) => m.id) || []) || [];
      const allIds = Array.from(new Set([...grpUserIds, ...invUserIds]));

      setTenderCollaborators(allIds.map(id => ({ id })));
    } catch (error) {
      console.error('Error fetching collaborators:', error);
    }
  };

  const fetchComments = async () => {
    try {
      setLoading(true);

      // Fetch top-level comments
      const { data: commentsData, error: commentsError } = await supabase
        .from('comments_with_user')
        .select('*')
        .eq('tender_id', tenderId)
        .is('parent_comment_id', null)
        .order('created_at', { ascending: false });

      if (commentsError) throw commentsError;

      setComments(commentsData || []);

      // Fetch replies for each comment
      const repliesMap: { [key: string]: Comment[] } = {};
      for (const comment of commentsData || []) {
        const { data: repliesData, error: repliesError } = await supabase
          .from('comments_with_user')
          .select('*')
          .eq('parent_comment_id', comment.id)
          .order('created_at', { ascending: true });

        if (!repliesError && repliesData) {
          repliesMap[comment.id] = repliesData;
        }
      }
      setReplies(repliesMap);

    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !currentUser) return;

    try {
      setSubmitting(true);

      const { data, error } = await supabase
        .from('comments')
        .insert({
          tender_id: tenderId,
          user_id: currentUser.id,
          parent_comment_id: replyTo,
          content: newComment.trim()
        })
        .select()
        .single();

      if (error) throw error;

      // Send notifications to collaborators
      const collaboratorIds = tenderCollaborators
        .map((c: any) => c.id)
        .filter((id: string) => id && id !== currentUser.id);

      if (collaboratorIds.length > 0) {
        const { data: tenderData } = await supabase
          .from('reponses_ao')
          .select('titre')
          .eq('id', tenderId)
          .single();

        await notifyCommentAdded(
          collaboratorIds,
          `${currentUser.prenom} ${currentUser.nom}`,
          currentUser.photo_url || '',
          tenderId,
          tenderData?.titre || '',
          newComment.substring(0, 50) + (newComment.length > 50 ? '...' : '')
        );
      }

      setNewComment('');
      setReplyTo(null);
      await fetchComments();
    } catch (error) {
      console.error('Error submitting comment:', error);
      showToast("Erreur lors de l'ajout du commentaire", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!currentUser) return;

    try {
      const { error } = await supabase.rpc('toggle_comment_like', {
        p_comment_id: commentId,
        p_user_id: currentUser.id
      });

      if (error) throw error;

      // Refresh comments to show updated likes
      await fetchComments();
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  };

  const handleEditComment = async (commentId: string) => {
    if (!editContent.trim()) return;

    try {
      const { error } = await supabase
        .from('comments')
        .update({ content: editContent.trim() })
        .eq('id', commentId);

      if (error) throw error;

      setEditingComment(null);
      setEditContent('');
      await fetchComments();
    } catch (error) {
      console.error('Error editing comment:', error);
      showToast('Erreur lors de la modification', 'error');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce commentaire ?')) return;

    try {
      const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;

      await fetchComments();
    } catch (error) {
      console.error('Error deleting comment:', error);
      showToast('Erreur lors de la suppression', 'error');
    }
  };

  const getSortedComments = () => {
    const sorted = [...comments];
    switch (sortOrder) {
      case 'newest':
        return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case 'oldest':
        return sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'likes':
        return sorted.sort((a, b) => b.like_count - a.like_count);
      default:
        return sorted;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `Il y a ${diffMins} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;

    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  const renderComment = (comment: Comment, isReply: boolean = false) => {
    const isLiked = comment.likes.includes(currentUser?.id);
    const isOwner = comment.user_id === currentUser?.id;
    const isEditing = editingComment === comment.id;

    return (
      <div key={comment.id} className={`relative group ${isReply ? '' : 'mb-12'}`}>
        <div className="flex gap-4">
          <img
            src={comment.photo_url || `https://ui-avatars.com/api/?name=${comment.prenom}+${comment.nom}&background=random`}
            alt={`${comment.prenom} ${comment.nom}`}
            className={`${isReply ? 'w-10 h-10' : 'w-14 h-14'} rounded-full object-cover border-2 border-white/20 shadow-lg flex-shrink-0`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 mb-2 flex-wrap">
              <span className={`font-bold ${isReply ? 'text-base' : 'text-lg'}`}>
                {comment.prenom} {comment.nom}
              </span>
              <span className="text-xs font-medium text-white/40 uppercase tracking-wide">
                {formatTimestamp(comment.created_at)}
                {comment.is_edited && ' (modifié)'}
              </span>
            </div>

            {isEditing ? (
              <div className="space-y-3">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-white/40 resize-none min-h-[100px]"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditComment(comment.id)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                  >
                    Enregistrer
                  </button>
                  <button
                    onClick={() => {
                      setEditingComment(null);
                      setEditContent('');
                    }}
                    className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors text-sm font-medium"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className={`text-white/90 ${isReply ? 'text-sm' : 'text-base'} leading-relaxed mb-3 whitespace-pre-wrap break-words`}>
                  {comment.content}
                </p>

                <div className="flex items-center gap-6 text-sm font-medium text-white/50">
                  <button
                    onClick={() => handleLikeComment(comment.id)}
                    className={`flex items-center gap-1.5 hover:text-white transition-colors ${isLiked ? 'text-red-400' : ''}`}
                  >
                    <Heart size={16} className={isLiked ? 'fill-current' : ''} />
                    {comment.like_count > 0 && <span>{comment.like_count}</span>}
                  </button>

                  {!isReply && (
                    <button
                      onClick={() => setReplyTo(comment.id)}
                      className="flex items-center gap-1.5 hover:text-white transition-colors"
                    >
                      <MessageSquare size={16} />
                      Répondre
                      {comment.reply_count > 0 && <span>({comment.reply_count})</span>}
                    </button>
                  )}

                  {isOwner && (
                    <>
                      <button
                        onClick={() => {
                          setEditingComment(comment.id);
                          setEditContent(comment.content);
                        }}
                        className="flex items-center gap-1.5 hover:text-white transition-colors"
                      >
                        <Edit2 size={14} />
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDeleteComment(comment.id)}
                        className="flex items-center gap-1.5 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                        Supprimer
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Replies */}
        {!isReply && replies[comment.id] && replies[comment.id].length > 0 && (
          <div className="mt-6 ml-8 pl-8 border-l-2 border-white/10 space-y-6">
            {replies[comment.id].map(reply => renderComment(reply, true))}
          </div>
        )}

        {/* Reply Form */}
        {replyTo === comment.id && (
          <div className="mt-4 ml-8 pl-8 border-l-2 border-blue-500/30">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={`Répondre à ${comment.prenom}...`}
                className="w-full bg-transparent border-none text-white placeholder-white/40 focus:outline-none resize-none min-h-[80px] text-sm"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => {
                    setReplyTo(null);
                    setNewComment('');
                  }}
                  className="px-4 py-2 text-white/60 hover:text-white text-sm font-medium"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSubmitComment}
                  disabled={submitting || !newComment.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send size={16} />}
                  Répondre
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const sortedComments = getSortedComments();

  return (
    <div className="animate-fade-in relative bg-white/30 backdrop-blur-sm rounded-3xl">
      <div className="bg-filao-wizard rounded-3xl p-8 md:p-12 shadow-2xl min-h-[600px] flex flex-col relative text-white">
        <div className="absolute top-8 right-8">
          <button onClick={onClose} className="text-white/50 hover:text-white transition-all">
            <X size={32} />
          </button>
        </div>

        <h2 className="text-3xl font-bold mb-8">Commentaires</h2>

        {/* New Comment Form */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-8 shadow-inner">
          <h3 className="font-bold text-base mb-4 text-white/80">Ajouter un commentaire</h3>
          <textarea
            ref={textareaRef}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Écrivez votre commentaire..."
            className="w-full bg-transparent border-none text-white placeholder-white/40 focus:outline-none resize-none min-h-[100px] text-base mb-4"
            disabled={submitting || replyTo !== null}
          />
          <div className="flex justify-between items-center pt-4 border-t border-white/10">
            <div className="flex items-center gap-4 text-white/40">
              <button className="hover:text-white transition-colors" title="Gras">
                <Bold size={18} />
              </button>
              <button className="hover:text-white transition-colors" title="Italique">
                <Italic size={18} />
              </button>
              <button className="hover:text-white transition-colors" title="Souligné">
                <Underline size={18} />
              </button>
            </div>
            <button
              onClick={handleSubmitComment}
              disabled={submitting || !newComment.trim() || replyTo !== null}
              className="bg-white text-gray-800 font-bold px-8 py-3 rounded-xl hover:bg-gray-100 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send size={18} />}
              Publier
            </button>
          </div>
        </div>

        {/* Comments Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3 bg-white/10 px-5 py-2.5 rounded-xl border border-white/10">
            <span className="font-bold text-base">Commentaires</span>
            <span className="bg-white text-gray-800 text-sm font-bold px-2.5 py-0.5 rounded-full">
              {comments.length}
            </span>
          </div>

          <div className="relative">
            <button
              onClick={() => {
                const orders: Array<'newest' | 'oldest' | 'likes'> = ['newest', 'oldest', 'likes'];
                const currentIndex = orders.indexOf(sortOrder);
                setSortOrder(orders[(currentIndex + 1) % orders.length]);
              }}
              className="flex items-center gap-2 font-medium text-sm text-white/60 hover:text-white transition-all group cursor-pointer"
            >
              <ArrowUpDown size={16} />
              {sortOrder === 'newest' && 'Plus récent'}
              {sortOrder === 'oldest' && 'Plus ancien'}
              {sortOrder === 'likes' && 'Plus aimés'}
              <ChevronDown size={16} className="group-hover:translate-y-0.5 transition-transform" />
            </button>
          </div>
        </div>

        {/* Comments List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-white/50" />
            </div>
          ) : sortedComments.length === 0 ? (
            <div className="text-center py-12 text-white/40">
              <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-lg">Aucun commentaire pour le moment</p>
              <p className="text-sm mt-2">Soyez le premier à commenter !</p>
            </div>
          ) : (
            <div className="space-y-8">
              {sortedComments.map(comment => renderComment(comment))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};