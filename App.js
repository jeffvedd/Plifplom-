import React, { useState, useRef, createContext, useContext, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  FlatList,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Modal,
  Dimensions,
  ScrollView,
  Alert,
  Share,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { createClient } from '@supabase/supabase-js';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as FileSystem from 'expo-file-system'; // Importar expo-file-system

// Supabase Config
const supabaseUrl = 'https://vytmcgbphuqaznlursyo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5dG1jZ2JwaHVxYXpubHVyc3lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MjM4NDksImV4cCI6MjA3MDQ5OTg0OX0.qyh42dN8Oi09PDImkVSja6Mz2C7iaI8kmwcfrosWnFY';
const supabase = createClient(supabaseUrl, supabaseKey);

// Cores
const COLORS = {
  primary: '#00C853',
  background: '#FFFFFF',
  text: '#212121',
  darkText: '#424242',
};

// Contexto de Autenticação
const AuthContext = createContext();

// --- TabBar com Blur e Área Segura ---
function TabBar({ selected, setSelected }) {
  const { bottom } = useSafeAreaInsets();
  const tabs = [
    { key: 'feed', label: 'Feed', icon: 'home' },
    { key: 'upload', label: 'Upload', icon: 'cloud-upload' },
    { key: 'messages', label: 'Mensagens', icon: 'chatbubble' },
    { key: 'profile', label: 'Perfil', icon: 'person' },
  ];
  return (
    <View style={[styles.tabBar, { bottom: bottom + 10 }]}>
      <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill}>
        <View style={styles.tabBarContent}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setSelected(tab.key)}
              style={styles.tabItem}
            >
              <Ionicons
                name={tab.icon}
                size={28}
                color={selected === tab.key ? COLORS.primary : COLORS.darkText}
              />
              <Text
                style={{
                  color: selected === tab.key ? COLORS.primary : COLORS.darkText,
                  fontWeight: selected === tab.key ? 'bold' : 'normal',
                  fontSize: 12,
                }}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </BlurView>
    </View>
  );
}

// --- FeedScreen ---
function FeedScreen() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commentModal, setCommentModal] = useState(false);
  const [currentPost, setCurrentPost] = useState(null);
  const [commentText, setCommentText] = useState('');
  const { user, setSelected, setViewingProfileUserId } = useContext(AuthContext);
  const { width, height } = Dimensions.get('window');
  const [activeVideoIndex, setActiveVideoIndex] = useState(null);

  useEffect(() => {
    fetchPosts();
    const channel = supabase
      .channel('posts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
        setPosts((prev) => [payload.new, ...prev]);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchPosts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) {
      console.log('Erro ao buscar feed:', error);
    } else {
      setPosts(data || []);
    }
  };

  const handleLike = async (id) => {
    const post = posts.find((p) => p.id === id);
    const hasLiked = post?.user_likes?.includes(user.id) || false;
    let newLikes = hasLiked ? (post.likes || 0) - 1 : (post.likes || 0) + 1;
    let newUserLikes = hasLiked
      ? post.user_likes.filter((uid) => uid !== user.id)
      : [...(post.user_likes || []), user.id];
    const { error } = await supabase
      .from('posts')
      .update({ likes: newLikes, user_likes: newUserLikes })
      .eq('id', id);
    if (error) {
      console.log('Erro ao curtir:', error);
      return;
    }
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, likes: newLikes, user_likes: newUserLikes } : p
      )
    );
  };

  const handleShare = async (item) => {
    try {
      await Share.share({
        message: `Veja no Plifplom: ${item.description}`,
        url: item.url,
      });
    } catch (err) {
      console.log('Erro ao compartilhar:', err);
    }
  };

  // --- MODIFICADO: Abre o modal para enviar mensagem ao dono do post ---
  const openCommentModal = (post) => {
    setCurrentPost(post);
    setCommentText('');
    setCommentModal(true);
  };

  // --- MODIFICADO: Envia uma mensagem direta em vez de comentar no post ---
  const handleComment = async () => {
    if (!commentText.trim() || !currentPost) return;
    // Verifica se o usuário do post existe
    if (!currentPost.user_id) {
        Alert.alert('Erro', 'Não foi possível identificar o destinatário da mensagem.');
        return;
    }
    // Impede o usuário de enviar mensagem para si mesmo
    if (user.id === currentPost.user_id) {
        Alert.alert('Erro', 'Você não pode enviar uma mensagem para si mesmo.');
        return;
    }
    try {
      // Insere a mensagem na tabela 'messages'
      const { error: insertError } = await supabase.from('messages').insert([
        {
          sender_id: user.id,
          recipient_id: currentPost.user_id, // Envia para o dono do post
          post_id: currentPost.id, // Opcional: vincula à postagem
          text: commentText.trim(),
        },
      ]);
      if (insertError) throw insertError;
      Alert.alert('Sucesso', 'Mensagem enviada!');
      setCommentModal(false); // Fecha o modal após enviar
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      Alert.alert('Erro', `Falha ao enviar mensagem: ${error.message}`);
    }
  };

  // --- Função para Excluir um Post no Feed (somente do próprio usuário) ---
  const handleDeletePostFromFeed = async (postId, postUrl, postUserId) => {
    // Verifica se o post pertence ao usuário logado
    if (user.id !== postUserId) {
      Alert.alert('Erro', 'Você só pode excluir seus próprios posts.');
      return;
    }
    Alert.alert(
      'Excluir Post',
      'Tem certeza que deseja excluir este post?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('Iniciando exclusão do post:', postId);
              // 1. Extrair nome do arquivo da URL pública
              let fileName = null;
              if (postUrl) {
                const parts = postUrl.split('/');
                fileName = parts[parts.length - 1];
                console.log('Arquivo a ser excluído do storage:', fileName);
              }
              // 2. Excluir arquivo do bucket 'midias' (se tiver nome)
              if (fileName) {
                const { error: storageError } = await supabase.storage
                  .from('midias')
                  .remove([fileName]); // remove aceita um array
                if (storageError) {
                  console.warn('Erro ao excluir arquivo do post do storage:', storageError);
                  // Mesmo que falhe, tenta excluir do banco
                } else {
                  console.log('Arquivo do post excluído do storage.');
                }
              }
              // 3. Excluir post da tabela 'posts'
              const { error: deletePostError } = await supabase
                .from('posts')
                .delete()
                .eq('id', postId)
                .eq('user_id', user.id); // Garante que só exclui posts do próprio usuário
              if (deletePostError) {
                throw deletePostError; // Lança erro para ser capturado pelo catch
              }
              console.log('Post excluído do banco.');
              Alert.alert('Sucesso', 'Post excluído com sucesso.');
              // O listener em tempo real vai atualizar o estado `posts`
              // setPosts(prev => prev.filter(p => p.id !== postId)); // Alternativa manual
            } catch (error) {
              console.error('Erro ao excluir post:', error);
              Alert.alert('Erro', `Falha ao excluir post: ${error.message}`);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const renderItem = ({ item, index }) => (
    <View style={{ width, height, backgroundColor: 'black' }}>
      {item.type === 'video' ? (
        <Video
          source={{ uri: item.url }}
          style={{ width, height }}
          resizeMode="cover"
          shouldPlay={false}
          isLooping
          useNativeControls={false}
          isMuted={index !== activeVideoIndex}
        />
      ) : (
        <Image source={{ uri: item.url }} style={{ width, height }} resizeMode="cover" />
      )}
      {/* --- NOVO: Bloco de avatar e nome do usuário no canto inferior esquerdo --- */}
      <TouchableOpacity
        onPress={() => {
            // Verificação mais robusta
            console.log("Tentando navegar para perfil de:", item.user_id);
            if (item.user_id && typeof item.user_id === 'string' && item.user_id !== user?.id) {
            console.log("Navegando para otherProfile com ID:", item.user_id);
            setViewingProfileUserId(item.user_id);
            setSelected('otherProfile');
            } else if (item.user_id === user?.id) {
            console.log("Navegando para perfil próprio");
            setSelected('profile');
            } else {
            console.warn("ID de usuário inválido ou usuário não encontrado no post:", item);
            // Opcional: Mostrar um alerta ou mensagem de erro
            }
        }}
        style={{ position: 'absolute', bottom: 100, left: 15, flexDirection: 'row', alignItems: 'center' }}
        >
        <Image
            source={{ uri: item.user_avatar || 'https://placehold.co/150/00C853/FFFFFF?text=U' }}
            style={{ width: 30, height: 30, borderRadius: 15, marginRight: 8, borderWidth: 1, borderColor: 'white' }}
        />
        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>
            {item.name || item.username || 'Usuário'}
        </Text>
        </TouchableOpacity>
      {/* --- NOVO: Ícone de Lixeira para Posts do Próprio Usuário (movido para o topo direito) --- */}
      {user && item.user_id === user.id && 
        <TouchableOpacity
          onPress={() => handleDeletePostFromFeed(item.id, item.url, item.user_id)}
          style={{ position: 'absolute', right: 10, top: 50 }} // Posicionado no topo direito
        >
          <Ionicons name="trash" size={24} color="white" />
        </TouchableOpacity>
      }
      <View style={[styles.actionsFull, { top: height * 0.3 }]}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleLike(item.id)}>
          <Ionicons
            name={item.user_likes?.includes(user.id) ? 'heart' : 'heart-outline'}
            size={30}
            color={COLORS.primary}
          />
          <Text style={styles.counter}>{item.likes || 0}</Text>
        </TouchableOpacity>
        {/* --- MODIFICADO: Botão de Comentar agora envia mensagem --- */}
        <TouchableOpacity style={styles.actionBtn} onPress={() => openCommentModal(item)}>
          <Ionicons name="chatbubble" size={28} color={COLORS.primary} />
          {/* Remove a contagem de comentários do feed */}
        </TouchableOpacity>
        {/* --- FIM MODIFICADO --- */}
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleShare(item)}>
          <Ionicons name="share-social" size={28} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
      {/* --- REMOVIDO: Exibição de comentários no feed --- */}
      <View style={{ position: 'absolute', bottom: 80, left: 15, right: 15 }}>
        <Text style={styles.description}>{item.description}</Text>
        {/* Comentários removidos daqui */}
      </View>
      {/* --- FIM REMOVIDO --- */}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={posts}
        renderItem={renderItem}
        keyExtractor={(item) => item.id?.toString() ?? item.url}
        pagingEnabled
        snapToInterval={height}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        windowSize={3}
        initialNumToRender={1}
        removeClippedSubviews
        getItemLayout={(data, index) => ({
          length: height,
          offset: height * index,
          index,
        })}
        onViewableItemsChanged={({ viewableItems }) => {
          const visible = viewableItems.find((item) => item.isViewable);
          setActiveVideoIndex(visible ? visible.index : null);
        }}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        ListEmptyComponent={
          loading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', height: height - 100 }}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', height: height - 100 }}>
              <Ionicons name="film" size={60} color={COLORS.primary} />
              <Text style={{ marginTop: 20, fontSize: 18, color: COLORS.darkText }}>
                Nenhum post ainda
              </Text>
            </View>
          )
        }
      />
      {/* --- MODAL DE MENSAGEM (reutilizando o commentModal) --- */}
      <Modal visible={commentModal} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enviar Mensagem</Text>
            {/* Exibe o nome do destinatário */}
            {currentPost && (
              <Text style={{ marginBottom: 10, color: COLORS.darkText }}>
                Para: {currentPost.name || currentPost.username || 'Usuário'}
              </Text>
            )}
            <TextInput
              style={styles.input}
              placeholder="Sua mensagem..."
              value={commentText}
              onChangeText={setCommentText}
              multiline
              numberOfLines={3}
            />
            <TouchableOpacity style={styles.postBtn} onPress={handleComment}>
              <Text style={{ color: COLORS.primary, fontWeight: 'bold' }}>Enviar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCommentModal(false)}>
              <Text style={styles.link}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* --- FIM MODAL --- */}
    </View>
  );
}

// --- MessagesScreen MODIFICADO (Busca Simples Sem Relacionamentos Complexos) ---
function MessagesScreen() {
  const { user } = useContext(AuthContext);
  const [chats, setChats] = useState([]); // Vai armazenar conversas únicas
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null); // Estado para armazenar erros
  // Carrega as conversas iniciais
  useEffect(() => {
    // Reseta estados ao carregar
    setChats([]);
    setError(null);
    if (!user) {
      console.log("MessagesScreen: Usuário não carregado ainda.");
      return; // Sai do useEffect se o usuário não estiver disponível
    }
    console.log("MessagesScreen: Usuário carregado, buscando conversas para:", user.id);
    fetchChats();
    // setupRealtimeListener(); // Pode ser adicionado depois, se necessário
  }, [user]); // Re-executa quando o usuário muda (loga/desloga)
  const fetchChats = async () => {
    if (!user || !user.id) {
      console.error("fetchChats: Usuário inválido");
      return;
    }
    setLoading(true);
    setError(null); // Limpa erros anteriores
    try {
      console.log("Iniciando fetchChats para user:", user.id);
      // 1. Busca todas as mensagens onde o usuário é remetente OU destinatário
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*') // Seleciona todas as colunas da mensagem
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order('created_at', { ascending: false }); // Ordena por data, mais recente primeiro
      if (messagesError) {
        console.error('Erro na consulta ao Supabase (messages):', messagesError);
        throw messagesError; // Lança o erro para ser capturado pelo catch
      }
      console.log("Mensagens brutos recebidos:", messagesData);
      // 2. Coleta os IDs únicos de todos os outros usuários envolvidos nessas mensagens
      const userIds = new Set();
      messagesData.forEach(msg => {
        // Garante que os IDs sejam strings válidas antes de adicionar
        if (msg.sender_id && typeof msg.sender_id === 'string') userIds.add(msg.sender_id);
        if (msg.recipient_id && typeof msg.recipient_id === 'string') userIds.add(msg.recipient_id);
      });
      // Adiciona o próprio usuário para garantir que seus dados estejam disponíveis se necessário
      userIds.add(user.id);
      const uniqueUserIds = Array.from(userIds).filter(id => id !== null && id !== undefined);
      console.log("IDs de usuários envolvidos (filtrados):", uniqueUserIds);
      // 3. Busca os perfis de todos esses usuários de uma vez
      let profilesData = [];
      if (uniqueUserIds.length > 0) {
        const { data, error: profilesError } = await supabase
          .from('profiles') // Certifique-se de que esta é a tabela correta
          .select('id, username, name, avatar_url') // Selecione apenas os campos necessários
          .in('id', uniqueUserIds); // Busca perfis cujo id está na lista
         if (profilesError) {
            console.error('Erro na consulta ao Supabase (profiles):', profilesError);
            // Podemos continuar, mas os nomes/avatar serão 'Desconhecido'
            Alert.alert('Aviso', 'Alguns dados de usuários podem não ser exibidos.');
         } else {
             profilesData = data || [];
         }
      }
      console.log("Perfis recebidos:", profilesData);
      // 4. Cria um mapa de ID para perfil para acesso rápido
      const profileMap = {};
      profilesData.forEach(profile => {
        if (profile.id) { // Garante que o perfil tenha um ID
            profileMap[profile.id] = profile;
        }
      });
      console.log("Mapa de perfis:", profileMap);
      // 5. Agrupa mensagens por pares de usuários para formar "conversas"
      const groupedChats = {};
      messagesData.forEach(msg => {
        // Determina o ID do outro usuário na conversa
        const otherUserId = msg.sender_id === user.id ? msg.recipient_id : msg.sender_id;
        // Se não for possível determinar o outro usuário, pula
        if (!otherUserId) return;
        const chatId = otherUserId.toString(); // Garante que seja string
        // Busca o perfil do outro usuário
        const otherUserProfile = profileMap[otherUserId];
        if (!groupedChats[chatId]) {
          // Inicializa a conversa se for a primeira mensagem
          groupedChats[chatId] = {
            id: chatId,
            user: otherUserProfile?.username || 'Desconhecido',
            name: otherUserProfile?.name || otherUserProfile?.username || 'Desconhecido',
            avatar: otherUserProfile?.avatar_url || 'https://placehold.co/50/45B7D1/FFFFFF?text=M',
            lastMessage: msg.text || '...', // Trata texto vazio/null
            time: msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...',
            unread: msg.recipient_id === user.id && !msg.read, // Marca como não lida
          };
        } else {
          // Se a conversa já existe, atualiza com base na última mensagem (já ordenada)
          // Como está ordenado por created_at DESC, a primeira mensagem do loop é a mais recente
          // Então, só atualiza se ainda não tiver definido lastMessage/time
          if (!groupedChats[chatId].lastMessage || groupedChats[chatId].lastMessage === '...') {
             groupedChats[chatId].lastMessage = msg.text || '...';
             groupedChats[chatId].time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...';
          }
          // Atualiza o status de não lida se houver uma mensagem não lida mais recente
          // (Esta lógica pode ser refinada)
          if (msg.recipient_id === user.id && !msg.read) {
             groupedChats[chatId].unread = true;
          }
        }
      });
      // Converte o objeto em array
      const sortedChats = Object.values(groupedChats);
      console.log("Conversas agrupadas:", sortedChats);
      setChats(sortedChats);
    } catch (err) {
      console.error('Erro detalhado em fetchChats:', err);
      setError('Falha ao carregar mensagens. Tente novamente.'); // Mensagem de erro para o usuário
      Alert.alert('Erro', `Falha ao carregar mensagens: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };
  const renderChatList = () => (
    <>
      <View style={styles.messagesHeader}>
        <Text style={styles.messagesTitle}>Mensagens</Text>
        {/* Botão de novo chat pode ser adicionado aqui */}
      </View>
      {error ? ( // Exibe mensagem de erro se houver
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ color: 'red', fontSize: 16 }}>{error}</Text>
          <TouchableOpacity onPress={fetchChats} style={{ marginTop: 10, padding: 10, borderColor: COLORS.primary, borderWidth: 1, borderRadius: 5 }}>
            <Text style={{ color: COLORS.primary }}>Tentar Novamente</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginVertical: 20 }} />
      ) : chats.length > 0 ? (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id} // item.id já é string
          renderItem={({ item }) => (
            <View // Usando View em vez de TouchableOpacity por enquanto
              style={[styles.chatItem, item.unread && { backgroundColor: '#e0f7fa' }]}
            >
              <Image source={{ uri: item.avatar }} style={styles.chatAvatar} />
              <View style={styles.chatInfo}>
                <Text style={styles.chatName}>{item.name}</Text>
                <Text style={[styles.chatMessage, item.unread && { fontWeight: 'bold' }]} numberOfLines={1}>
                  {item.lastMessage}
                </Text>
              </View>
              <Text style={styles.chatTime}>{item.time}</Text>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="chatbubble" size={60} color={COLORS.primary} />
          <Text style={{ marginTop: 20, fontSize: 18, color: COLORS.darkText }}>
            Nenhuma mensagem ainda
          </Text>
        </View>
      )}
    </>
  );
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {renderChatList()}
    </View>
  );
}

// --- FIM MessagesScreen MODIFICADO ---
// --- OtherUserProfileScreen ---
function OtherUserProfileScreen({ userId, onBack }) { // userId do usuário cujo perfil será mostrado
  const [profileUser, setProfileUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { user: currentUser } = useContext(AuthContext); // Usuário logado
  const [isFollowing, setIsFollowing] = useState(false);
  const [loadingFollow, setLoadingFollow] = useState(false);
  useEffect(() => {
    console.log("OtherUserProfileScreen montado/alterado. userId recebido:", userId);
    if (!userId || typeof userId !== 'string') {
        console.error("ID de usuário inválido recebido no OtherUserProfileScreen:", userId);
        setError('ID de usuário inválido.');
        return;
    }
    fetchProfileUser();
    if (currentUser && currentUser.id !== userId) {
        checkIfFollowing(userId);
    } else if (currentUser && currentUser.id === userId) {
         // Se por algum motivo acabar aqui, redireciona para o perfil próprio
         console.warn("Tentando visualizar o próprio perfil via OtherUserProfileScreen. Redirecionando.");
         onBack(); // ou setSelected('profile') se tiver acesso ao setSelected
    }
  }, [userId, currentUser?.id]);
  const fetchProfileUser = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log("Buscando perfil para ID:", userId);
      // 1. Buscar perfil
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single(); // single() falha se não encontrar ou encontrar mais de um
      if (profileError) {
        console.error("Erro ao buscar perfil do usuário (Supabase):", profileError);
        // Trata erros específicos
        if (profileError.code === 'PGRST116') { // Código para "JSON object requested, multiple (or no) rows returned"
             setError('Usuário não encontrado.');
        } else {
             setError(`Falha ao carregar perfil: ${profileError.message}`);
        }
        return; // Sai da função se houver erro
      }
      if (!profileData) {
         console.warn("Nenhum dado retornado para o perfil do ID:", userId);
         setError('Usuário não encontrado.');
         return;
      }
      console.log("Perfil do usuário carregado:", profileData);
      setProfileUser(profileData);
      // 2. Buscar contagem de seguidores/seguindo (se não estiver no perfil)
      // Se suas colunas followers_count e following_count estiverem atualizadas em tempo real,
      // você pode usar os valores de profileData diretamente.
      // Caso contrário, busque aqui:
      /*
      const { data: followersCountData, error: followersCountError } = await supabase
        .from('followers')
        .select('count()', { count: 'exact' }) // Conta o número de linhas
        .eq('following_id', userId);
      const { data: followingCountData, error: followingCountError } = await supabase
        .from('followers')
        .select('count()', { count: 'exact' })
        .eq('follower_id', userId);
      if (!followersCountError && followersCountData) {
        setProfileUser(prev => ({ ...prev, followers_count: followersCountData[0]?.count || 0 }));
      }
      if (!followingCountError && followingCountData) {
        setProfileUser(prev => ({ ...prev, following_count: followingCountData[0]?.count || 0 }));
      }
      */
    } catch (err) {
      console.error("Erro inesperado ao buscar perfil do usuário:", err);
      setError('Falha inesperada ao carregar perfil.');
    } finally {
      setLoading(false);
    }
  };
  const checkIfFollowing = async (targetUserId) => {
    if (!currentUser || !targetUserId) return;
    try {
      console.log("Verificando se", currentUser.id, "segue", targetUserId);
      const { data, error } = await supabase
        .from('followers')
        .select('id')
        .eq('follower_id', currentUser.id)
        .eq('following_id', targetUserId)
        .maybeSingle(); // maybeSingle retorna null se não encontrar, evita erro
      if (error) {
         console.error("Erro ao verificar se está seguindo:", error);
         // Mesmo que falhe, assume que não está seguindo
         setIsFollowing(false);
         return;
      }
      const isCurrentlyFollowing = !!data;
      console.log("Resultado da verificação de seguir:", isCurrentlyFollowing);
      setIsFollowing(isCurrentlyFollowing);
    } catch (err) {
      console.error("Erro inesperado ao verificar se está seguindo:", err);
      setIsFollowing(false); // Assume que não está seguindo em caso de erro
    }
  };
  const toggleFollow = async (targetUserId) => {
    if (!currentUser || !targetUserId || currentUser.id === targetUserId) return;
    setLoadingFollow(true);
    try {
      console.log("Tentando (des)seguir:", targetUserId, "isFollowing:", isFollowing);
      if (isFollowing) {
        // Deixar de seguir
        const { error } = await supabase
          .from('followers')
          .delete()
          .match({ follower_id: currentUser.id, following_id: targetUserId });
        if (error) throw error;
        console.log("Deixou de seguir com sucesso.");
        // Atualiza contadores localmente (opcional, pode ser feito via trigger no banco)
        setProfileUser(prev => ({ ...prev, followers_count: Math.max(0, (prev.followers_count || 0) - 1) }));
        setIsFollowing(false); // Atualiza estado local
      } else {
        // Seguir
        const { error } = await supabase
          .from('followers')
          .insert([{ follower_id: currentUser.id, following_id: targetUserId }]);
        if (error) throw error;
        console.log("Começou a seguir com sucesso.");
         // Atualiza contadores localmente (opcional)
        setProfileUser(prev => ({ ...prev, followers_count: (prev.followers_count || 0) + 1 }));
        setIsFollowing(true); // Atualiza estado local
      }
      // Não precisa inverter isFollowing aqui, pois já foi atualizado acima
    } catch (err) {
      console.error("Erro ao (des)seguir:", err);
      Alert.alert('Erro', `Falha ao atualizar seguidores: ${err.message}`);
    } finally {
      setLoadingFollow(false);
    }
  };
  // Renderizações para diferentes estados
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 10, color: COLORS.darkText }}>Carregando perfil...</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: 20 }}>
        <Text style={{ color: 'red', fontSize: 18, textAlign: 'center' }}>{error}</Text>
        <TouchableOpacity onPress={fetchProfileUser} style={{ marginTop: 15, padding: 10, borderColor: COLORS.primary, borderWidth: 1, borderRadius: 5 }}>
          <Text style={{ color: COLORS.primary }}>Tentar Novamente</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack} style={{ marginTop: 10, padding: 10 }}>
          <Text style={{ color: COLORS.darkText }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!profileUser) {
    // Este caso pode ser redundante com o 'error', mas é uma camada extra de segurança
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <Text style={{ fontSize: 18, color: COLORS.darkText }}>Perfil não disponível.</Text>
        <TouchableOpacity onPress={onBack} style={{ marginTop: 10, padding: 10 }}>
          <Text style={{ color: COLORS.primary }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }
  // Renderização principal do perfil
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={styles.profileHeader}>
        <Image source={{ uri: profileUser.avatar_url || 'https://placehold.co/150/00C853/FFFFFF?text=U' }} style={styles.profileAvatar} />
        <Text style={styles.profileName}>{profileUser.name || profileUser.username || 'Usuário'}</Text>
        <Text style={styles.profileUsername}>@{profileUser.username || 'usuario'}</Text>
        <Text style={styles.profileBio}>{profileUser.bio || 'Sem biografia.'}</Text>
      </View>
      <View style={styles.profileStats}>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{profileUser.followers_count !== undefined ? profileUser.followers_count : '...'}</Text>
          <Text style={styles.statLabel}>Seguidores</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{profileUser.following_count !== undefined ? profileUser.following_count : '...'}</Text>
          <Text style={styles.statLabel}>Seguindo</Text>
        </View>
        {/* Curtidas podem ser mais complexas de calcular */}
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{profileUser.likes || 0}</Text>
          <Text style={styles.statLabel}>Curtidas</Text>
        </View>
      </View>
      {/* Botão de Seguir/Deixar de Seguir */}
      {currentUser && currentUser.id !== profileUser.id && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', padding: 16 }}>
          <TouchableOpacity
            style={[styles.editBtn, { borderColor: isFollowing ? 'red' : COLORS.primary }]}
            onPress={() => toggleFollow(profileUser.id)}
            disabled={loadingFollow}
          >
            {loadingFollow ? (
              <ActivityIndicator size="small" color={isFollowing ? 'red' : COLORS.primary} />
            ) : (
              <Text style={{ color: isFollowing ? 'red' : COLORS.primary, fontWeight: 'bold' }}>
                {isFollowing ? 'Deixar de Seguir' : 'Seguir'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
      {/* Seção de Posts do Usuário (somente leitura) */}
      <View style={styles.userPosts}>
        <Text style={styles.postsTitle}>Posts</Text>
        {/* Aqui você pode adicionar a lógica para buscar e mostrar os posts do profileUser */}
        <Text style={styles.noPosts}>Funcionalidade de posts do perfil em breve...</Text>
      </View>
      <View style={{ padding: 16 }}>
        <TouchableOpacity style={[styles.editBtn, { borderColor: 'gray' }]} onPress={onBack}>
          <Text style={{ color: 'gray', fontWeight: 'bold' }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// --- FIM OtherUserProfileScreen ---
// --- UploadScreen ---
function UploadScreen() {
  const [media, setMedia] = useState(null);
  const [desc, setDesc] = useState('');
  const { user } = useContext(AuthContext);
  const [uploading, setUploading] = useState(false);

  const pickMedia = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert('Permissão necessária', 'Permita o acesso à sua biblioteca de mídia');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setMedia(result.assets[0]);
    }
  };

  const handlePost = async () => {
    if (!media || !desc.trim()) {
      Alert.alert('Erro', 'Por favor, selecione uma mídia e adicione uma descrição');
      return;
    }
    setUploading(true);
    try {
      // --- CORREÇÃO: Ler o conteúdo do arquivo como base64 ---
      const fileUri = media.uri;
      
      // Verificar se é um arquivo local válido
      if (!fileUri || !fileUri.startsWith('file://')) {
        throw new Error('URI inválida para o arquivo');
      }

      // Ler o conteúdo do arquivo como base64
      const base64Content = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Extrair extensão e tipo
      const fileExt = media.uri.split('.').pop().toLowerCase();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const contentType = media.type === 'video' ? `video/${fileExt}` : `image/${fileExt}`;

      console.log('Tentando upload:', { fileName, contentType, uri: fileUri });

      // Upload com conteúdo base64
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('midias')
        .upload(fileName, base64Content, { // Usar conteúdo base64 diretamente
          contentType,
          upsert: false,
        });

      if (uploadError) {
        console.error('Erro no upload:', uploadError);
        Alert.alert('Erro', `Upload falhou: ${uploadError.message}`);
        return;
      }

      console.log('Upload bem-sucedido:', uploadData);

      // Gerar URL pública
      const { data: publicUrlData } = supabase.storage
        .from('midias')
        .getPublicUrl(fileName);

      let publicUrl = publicUrlData?.publicUrl;
      // Fallback manual caso getPublicUrl falhe
      if (!publicUrl) {
        console.warn('getPublicUrl falhou, usando URL manual');
        publicUrl = `https://vytmcgbphuqaznlursyo.supabase.co/storage/v1/object/public/midias/${fileName}`;
      }

      console.log('URL pública gerada:', publicUrl);

      // Inserir no banco - ATUALIZADO para incluir user_id e name
      const { error: insertError } = await supabase.from('posts').insert([
        {
          url: publicUrl,
          description: desc.trim(),
          type: media.type,
          name: user.name, // Adicionado name
          username: user.username,
          user_avatar: user.avatar,
          user_id: user.id, // Adicionado user_id
          likes: 0,
          comments: [],
          user_likes: [],
        },
      ]);

      if (insertError) throw insertError;

      Alert.alert('Sucesso', 'Post publicado com sucesso!');
      setMedia(null);
      setDesc('');
    } catch (error) {
      console.error('Erro completo:', error);
      if (error.message && error.message.includes('network request failed')) {
        Alert.alert('Erro de Rede', 'Falha na conexão com o servidor. Verifique sua internet e tente novamente.');
      } else {
        Alert.alert('Erro', `Falha ao publicar: ${error.message}`);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background, padding: 28 }}>
      <Text style={styles.title}>Upload de Mídia</Text>
      <TouchableOpacity style={styles.uploadBtn} onPress={pickMedia}>
        <Ionicons name="cloud-upload" size={32} color={COLORS.primary} />
        <Text style={styles.uploadText}>Selecionar vídeo ou imagem</Text>
      </TouchableOpacity>
      {media && (
        <View style={styles.preview}>
          {media.type === 'video' ? (
            <View style={styles.videoPreview}>
              <Ionicons name="videocam" size={40} color={COLORS.primary} />
              <Text style={{ color: COLORS.primary, marginTop: 10 }}>Vídeo selecionado</Text>
            </View>
          ) : (
            <Image source={{ uri: media.uri }} style={styles.previewImage} />
          )}
          <TextInput
            style={styles.input}
            placeholder="Descreva seu conteúdo..."
            value={desc}
            onChangeText={setDesc}
            multiline
            numberOfLines={3}
          />
          <TouchableOpacity style={styles.postBtn} onPress={handlePost} disabled={uploading}>
            {uploading ? <ActivityIndicator color={COLORS.primary} /> : <Text style={{ color: COLORS.primary, fontWeight: 'bold' }}>Publicar</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

// --- ProfileScreen ---
function ProfileScreen() {
  const { user, setUser } = useContext(AuthContext);
  const [editModal, setEditModal] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editBio, setEditBio] = useState(user?.bio || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [saving, setSaving] = useState(false);
  // --- Estados para posts do usuário ---
  const [userPosts, setUserPosts] = useState([]);
  const [loadingUserPosts, setLoadingUserPosts] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState(null); // Para mostrar loading na exclusão
  // --- Buscar posts do usuário ---
  const fetchUserPosts = async () => {
    if (!user?.id) return;
    setLoadingUserPosts(true);
    // Assume que a tabela 'posts' tem uma coluna 'user_id' referenciando o usuário
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('user_id', user.id) // FILTRO PELO ID DO USUÁRIO
      .order('created_at', { ascending: false });
    setLoadingUserPosts(false);
    if (error) {
      console.log('Erro ao buscar posts do perfil:', error);
      Alert.alert('Erro', 'Falha ao carregar seus posts.');
    } else {
      setUserPosts(data || []);
    }
  };
  // --- useEffect para carregar posts do perfil ---
  useEffect(() => {
    fetchUserPosts();
    // Listener em tempo real para posts do usuário
    const channel = supabase
      .channel(`profile_posts_${user?.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts', filter: `user_id=eq.${user?.id}` },
        (payload) => {
          setUserPosts((prev) => [payload.new, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts', filter: `user_id=eq.${user?.id}` },
        (payload) => {
          setUserPosts((prev) =>
            prev.map((p) => (p.id === payload.new.id ? payload.new : p))
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'posts', filter: `user_id=eq.${user?.id}` },
        (payload) => {
          setUserPosts((prev) =>
            prev.filter((p) => p.id !== payload.old.id)
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]); // Re-executa se o user.id mudar

  // --- NOVO: Função para Selecionar Avatar ---
  const pickAvatar = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permissão necessária', 'Permita o acesso à sua biblioteca de fotos');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setAvatar(result.assets[0].uri);
    }
  };

  // --- FIM NOVO ---
  // --- NOVO: Função para Salvar Perfil ---
  const saveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert('Erro', 'Por favor, insira um nome');
      return;
    }
    setSaving(true);
    try {
      let finalAvatar = avatar;
      if (avatar !== user.avatar && avatar.startsWith('file://')) {
        const fileExt = avatar.split('.').pop().toLowerCase();
        const fileName = `avatar_${user.id}_${Date.now()}.${fileExt}`;
        const contentType = `image/${fileExt}`;
        console.log('Upload do avatar:', { fileName, uri: avatar });
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, { uri: avatar }, { contentType, upsert: false });
        if (uploadError) {
          console.error('Erro no upload do avatar:', uploadError);
          Alert.alert('Erro', `Falha ao fazer upload do avatar: ${uploadError.message}`);
          return;
        }
        console.log('Upload do avatar bem-sucedido:', uploadData);
        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
        finalAvatar = publicUrlData?.publicUrl;
        // Fallback manual
        if (!finalAvatar) {
          console.warn('getPublicUrl falhou para avatar, usando URL manual');
          finalAvatar = `https://vytmcgbphuqaznlursyo.supabase.co/storage/v1/object/public/avatars/${fileName}`;
        }
        console.log('URL do avatar:', finalAvatar);
      }
      const { error } = await supabase
        .from('profiles')
        .update({ name: editName.trim(), bio: editBio.trim(), avatar_url: finalAvatar })
        .eq('id', user.id);
      if (error) throw error;
      setUser({ ...user, name: editName.trim(), bio: editBio.trim(), avatar: finalAvatar });
      setEditModal(false);
      Alert.alert('Sucesso', 'Perfil atualizado com sucesso!');
    } catch (error) {
      console.error('Erro completo ao salvar perfil:', error);
      Alert.alert('Erro', `Falha ao atualizar perfil: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // --- FIM NOVO ---
  // --- NOVO: Função para Deslogar (Sair) ---
  const handleLogout = async () => {
    Alert.alert(
      'Sair',
      'Tem certeza que deseja sair?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair', // Texto alterado
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.auth.signOut();
            if (error) {
              console.error('Erro ao sair:', error);
              Alert.alert('Erro', 'Falha ao sair. Tente novamente.');
            } else {
              // setUser(null) é chamado pelo listener de authStateChange no App.js
              console.log('Usuário deslogado com sucesso.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // --- FIM NOVO ---
  // --- NOVO: Função para Excluir Conta ---
  const handleDeleteAccount = async () => {
    Alert.alert(
      'Excluir Conta',
      'Tem certeza que deseja excluir sua conta permanentemente? Esta ação não pode ser desfeita. Todos os seus dados (perfil, posts, mídias) serão perdidos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir', // Texto alterado
          style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            setSaving(true); // Reutilizando o estado de saving para indicar processo
            try {
              console.log('Iniciando exclusão da conta para o usuário:', user.id);
              // 1. Buscar posts do usuário para excluir os arquivos de mídia
              const { data: postsData, error: postsError } = await supabase
                .from('posts')
                .select('url')
                .eq('user_id', user.id);
              if (postsError) {
                console.warn('Erro ao buscar posts para exclusão de mídia:', postsError);
                // Continuar mesmo assim, tentar excluir outros dados
              }
              // 2. Extrair nomes dos arquivos dos posts para excluir do storage
              const postFileNames = (postsData || []).map(post => {
                // Extrair o nome do arquivo da URL pública
                // Ex: https://.../storage/v1/object/public/midias/nome_do_arquivo.jpg
                const parts = post.url.split('/');
                return parts[parts.length - 1];
              }).filter(name => name); // Filtra nomes vazios
              console.log('Arquivos de posts a serem excluídos:', postFileNames);
              // 3. Excluir arquivos de posts do bucket 'midias'
              if (postFileNames.length > 0) {
                const { error: storageError } = await supabase.storage
                  .from('midias')
                  .remove(postFileNames); // remove aceita um array de nomes de arquivos
                if (storageError) {
                  console.warn('Erro ao excluir arquivos de posts do storage:', storageError);
                  // Continuar mesmo assim
                } else {
                  console.log('Arquivos de posts excluídos do storage.');
                }
              }
              // 4. Extrair nome do avatar para excluir do storage (se não for o placeholder)
              let avatarFileName = null;
              if (user.avatar && !user.avatar.includes('placehold.co')) {
                const avatarParts = user.avatar.split('/');
                avatarFileName = avatarParts[avatarParts.length - 1];
                console.log('Arquivo de avatar a ser excluído:', avatarFileName);
              }
              // 5. Excluir avatar do bucket 'avatars'
              if (avatarFileName) {
                const { error: avatarStorageError } = await supabase.storage
                  .from('avatars')
                  .remove([avatarFileName]); // remove aceita um array
                if (avatarStorageError) {
                  console.warn('Erro ao excluir avatar do storage:', avatarStorageError);
                } else {
                  console.log('Avatar excluído do storage.');
                }
              }
              // 6. Excluir posts do usuário da tabela 'posts'
              const { error: deletePostsError } = await supabase
                .from('posts')
                .delete()
                .eq('user_id', user.id);
              if (deletePostsError) {
                console.warn('Erro ao excluir posts do banco:', deletePostsError);
              } else {
                console.log('Posts do usuário excluídos do banco.');
              }
              // 7. Excluir perfil do usuário da tabela 'profiles'
              const { error: deleteProfileError } = await supabase
                .from('profiles')
                .delete()
                .eq('id', user.id);
              if (deleteProfileError) {
                console.warn('Erro ao excluir perfil do banco:', deleteProfileError);
              } else {
                console.log('Perfil do usuário excluído do banco.');
              }
              // 8. Excluir o usuário da autenticação (último passo)
              // Nota: Supabase não tem uma função direta para excluir um usuário autenticado via SDK.
              // Você pode fazer isso no painel do Supabase ou usando uma função RPC.
              // Aqui, vamos apenas deslogar. A exclusão real do usuário precisa ser feita de outra forma,
              // ou você pode criar uma função no Supabase para isso.
              // Supondo que você tenha uma função RPC chamada 'delete_user' que recebe o user_id:
              /*
              const { error: deleteUserError } = await supabase.rpc('delete_user', { user_id: user.id });
              if (deleteUserError) {
                console.error('Erro ao chamar função RPC delete_user:', deleteUserError);
                Alert.alert('Erro', 'Falha ao excluir conta no servidor. Contate o suporte.');
                return; // Não desloga se a exclusão falhar
              }
              */
              // Como não temos a função RPC, vamos apenas deslogar.
              console.log('Exclusão de dados concluída (exceto usuário auth). Deslogando...');
              const { error: signOutError } = await supabase.auth.signOut();
              if (signOutError) {
                console.error('Erro ao deslogar após exclusão:', signOutError);
              }
              // O listener de authStateChange no App.js vai cuidar de setUser(null)
              Alert.alert('Sucesso', 'Sua conta e dados foram excluídos. Você foi deslogado.');
            } catch (error) {
              console.error('Erro completo ao excluir conta:', error);
              Alert.alert('Erro', `Falha ao excluir conta: ${error.message}`);
            } finally {
              setSaving(false);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // --- FIM NOVO ---
  // --- NOVO: Função para Excluir um Post do Usuário ---
  const handleDeletePost = async (postId, postUrl) => {
    if (deletingPostId) {
        // Evita cliques múltiplos enquanto uma exclusão está em andamento
      return;
    }
    Alert.alert(
      'Excluir Post',
      'Tem certeza que deseja excluir este post?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir', // Texto alterado
          style: 'destructive',
          onPress: async () => {
            setDeletingPostId(postId); // Indica qual post está sendo excluído
            try {
              console.log('Iniciando exclusão do post:', postId);
                // 1. Extrair nome do arquivo da URL pública
              let fileName = null;
              if (postUrl) {
                const parts = postUrl.split('/');
                fileName = parts[parts.length - 1];
                console.log('Arquivo a ser excluído do storage:', fileName);
              }
                // 2. Excluir arquivo do bucket 'midias' (se tiver nome)
              if (fileName) {
                const { error: storageError } = await supabase.storage
                  .from('midias')
                  .remove([fileName]); // remove aceita um array
                if (storageError) {
                  console.warn('Erro ao excluir arquivo do post do storage:', storageError);
                  // Mesmo que falhe, tenta excluir do banco
                } else {
                  console.log('Arquivo do post excluído do storage.');
                }
              }
                // 3. Excluir post da tabela 'posts'
              const { error: deletePostError } = await supabase
                .from('posts')
                .delete()
                .eq('id', postId)
                .eq('user_id', user.id); // Garante que só exclui posts do próprio usuário
              if (deletePostError) {
                throw deletePostError; // Lança erro para ser capturado pelo catch
              }
              console.log('Post excluído do banco.');
              Alert.alert('Sucesso', 'Post excluído com sucesso.');
                // O listener em tempo real vai atualizar o estado `userPosts`
                // setUserPosts(prev => prev.filter(p => p.id !== postId)); // Alternativa manual
            } catch (error) {
              console.error('Erro ao excluir post:', error);
              Alert.alert('Erro', `Falha ao excluir post: ${error.message}`);
            } finally {
              setDeletingPostId(null); // Reseta o estado de loading
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // --- FIM NOVO ---
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={styles.profileHeader}>
        <TouchableOpacity onPress={() => setEditModal(true)}>
          <Image source={{ uri: avatar }} style={styles.profileAvatar} />
          <Ionicons name="camera" size={24} color={COLORS.primary} style={styles.cameraIcon} />
        </TouchableOpacity>
        <Text style={styles.profileName}>{user?.name}</Text>
        <Text style={styles.profileUsername}>@{user?.username}</Text>
        <Text style={styles.profileBio}>{user?.bio}</Text>
      </View>
      <View style={styles.profileStats}>
        <TouchableOpacity style={styles.statItem}>
          <Text style={styles.statNum}>{user?.followers}</Text>
          <Text style={styles.statLabel}>Seguidores</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statItem}>
          <Text style={styles.statNum}>{user?.following}</Text>
          <Text style={styles.statLabel}>Seguindo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statItem}>
          <Text style={styles.statNum}>{user?.likes}</Text>
          <Text style={styles.statLabel}>Curtidas</Text>
        </TouchableOpacity>
      </View>
      {/* --- MODIFICADO: Botões de Ação do Perfil (Editar, Sair, Excluir) --- */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', padding: 16, gap: 10 }}>
        <TouchableOpacity style={styles.editBtn} onPress={() => setEditModal(true)}>
          <Text style={{ color: COLORS.primary, fontWeight: 'bold' }}>Editar Perfil</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.editBtn, { borderColor: 'gray' }]} onPress={handleLogout}>
          <Text style={{ color: 'gray', fontWeight: 'bold' }}>Sair</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.editBtn, { borderColor: 'red' }]} onPress={handleDeleteAccount} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="red" />
          ) : (
            <Text style={{ color: 'red', fontWeight: 'bold' }}>Excluir</Text>
          )}
        </TouchableOpacity>
      </View>
      {/* --- FIM MODIFICADO --- */}
      {/* --- MODIFICADO: Seção de Posts do Usuário com Exclusão --- */}
      <View style={styles.userPosts}>
        <Text style={styles.postsTitle}>Seus Posts</Text>
        {loadingUserPosts ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginVertical: 20 }} />
        ) : userPosts.length > 0 ? (
          <FlatList
            data={userPosts}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id?.toString() ?? item.url}
            renderItem={({ item }) => (
              <View style={{ marginHorizontal: 5, alignItems: 'center' }}> {/* Container para o post e o botão de delete */}
                <TouchableOpacity>
                  {item.type === 'video' ? (
                    <View style={{ width: 100, height: 100, backgroundColor: '#ccc', justifyContent: 'center', alignItems: 'center', borderRadius: 8 }}>
                      <Ionicons name="videocam" size={30} color={COLORS.primary} />
                    </View>
                  ) : (
                    <Image source={{ uri: item.url }} style={{ width: 100, height: 100, borderRadius: 8 }} resizeMode="cover" />
                  )}
                </TouchableOpacity>
                {/* Botão de Excluir Post */}
                <TouchableOpacity
                  onPress={() => handleDeletePost(item.id, item.url)}
                  style={{ marginTop: 5, padding: 5 }}
                  disabled={deletingPostId === item.id} // Desabilita enquanto exclui
                >
                  {deletingPostId === item.id ? (
                    <ActivityIndicator size="small" color={COLORS.primary} />
                  ) : (
                    <Ionicons name="trash" size={20} color="red" />
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        ) : (
          <Text style={styles.noPosts}>Nenhum post ainda</Text>
        )}
      </View>
      {/* --- FIM MODIFICADO --- */}
      <Modal visible={editModal} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Editar Perfil</Text>
            <TouchableOpacity onPress={pickAvatar} style={styles.avatarPicker}>
              <Image source={{ uri: avatar }} style={styles.modalAvatar} />
              <Text style={{ color: COLORS.primary, marginTop: 10 }}>Alterar foto</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder="Nome"
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Biografia"
              value={editBio}
              onChangeText={setEditBio}
              multiline
              numberOfLines={4}
            />
            <TouchableOpacity style={styles.postBtn} onPress={saveProfile} disabled={saving}>
              {saving ? <ActivityIndicator color={COLORS.primary} /> : <Text style={{ color: COLORS.primary, fontWeight: 'bold' }}>Salvar</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditModal(false)}>
              <Text style={styles.link}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// --- LoginScreen ---
function LoginScreen({ onLogin, onSignup }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('Preencha usuário e senha!');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: username, password });
    setLoading(false);
    if (error || !data.user) {
      Alert.alert('Erro no login', error?.message ?? 'Usuário/senha inválido.');
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    const userData = {
      id: data.user.id,
      name: profile?.name || username.split('@')[0],
      username,
      avatar: profile?.avatar_url || 'https://placehold.co/150/00C853/FFFFFF?text=U',
      bio: profile?.bio || 'Bem-vindo ao Plifplom!',
      followers: profile?.followers || 0,
      following: profile?.following || 0,
      likes: profile?.likes || 0,
    };
    onLogin(userData);
  };
  return (
    <KeyboardAvoidingView style={styles.loginContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={styles.appTitleLogin}>Plifplom</Text>
      <Text style={styles.loginLabel}>Login</Text>
      <TextInput
        style={styles.input}
        placeholder="Usuário (email)"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.postBtn} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color={COLORS.primary} /> : <Text style={{ color: COLORS.primary, fontWeight: 'bold' }}>Entrar</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={onSignup}>
        <Text style={styles.link}>Criar Conta</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// --- SignUpScreen ---
function SignUpScreen({ onSignup, onBack }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSignup = async () => {
    if (!email || !password || !name) {
      Alert.alert('Preencha todos os campos!');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    setLoading(false);
    if (error) {
      Alert.alert('Erro ao cadastrar', error.message);
      return;
    }
    Alert.alert(
      'Confirmação Necessária',
      'Um email de confirmação foi enviado para ' + email + '. Por favor, clique no link do email para ativar sua conta antes de fazer login.'
    );
    onSignup();
  };
  return (
    <KeyboardAvoidingView style={styles.loginContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={styles.appTitleLogin}>Plifplom</Text>
      <Text style={styles.loginLabel}>Cadastro</Text>
      <TextInput style={styles.input} placeholder="Nome" value={name} onChangeText={setName} />
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.postBtn} onPress={handleSignup} disabled={loading}>
        {loading ? <ActivityIndicator color={COLORS.primary} /> : <Text style={{ color: COLORS.primary, fontWeight: 'bold' }}>Criar Conta</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.link}>Voltar para Login</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// --- App Principal ---
export default function App() {
  const [selected, setSelected] = useState('feed');
  const [user, setUser] = useState(null);
  const [showSignup, setShowSignup] = useState(false);
  const [viewingProfileUserId, setViewingProfileUserId] = useState(null); // Novo estado
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (profile) {
          setUser({
            id: session.user.id,
            name: profile.name,
            username: profile.username,
            avatar: profile.avatar_url,
            bio: profile.bio,
            followers: profile.followers,
            following: profile.following,
            likes: profile.likes,
          });
        }
      }
    };
    checkSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) {
        supabase.from('profiles').select('*').eq('id', session.user.id).single().then(({ data: profile }) => {
          if (profile) {
            setUser({
              id: session.user.id,
              name: profile.name,
              username: profile.username,
              avatar: profile.avatar_url,
              bio: profile.bio,
              followers: profile.followers,
              following: profile.following,
              likes: profile.likes,
            });
          }
        });
      } else {
        setUser(null);
        setSelected('feed');
        setViewingProfileUserId(null); // Limpa o ID ao deslogar
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);
  // Função para lidar com o voltar de forma mais segura
  const handleBackFromOtherProfile = () => {
    setSelected('feed');
    setViewingProfileUserId(null); // <--- Limpar ao voltar
  };
  let Screen;
  if (!user) {
    Screen = showSignup
      ? () => <SignUpScreen onSignup={() => setShowSignup(false)} onBack={() => setShowSignup(false)} />
      : () => <LoginScreen onLogin={setUser} onSignup={() => setShowSignup(true)} />;
  } else if (selected === 'feed') Screen = FeedScreen;
  else if (selected === 'upload') Screen = UploadScreen;
  else if (selected === 'messages') Screen = MessagesScreen;
  else if (selected === 'profile') Screen = ProfileScreen;
  // Nova condição para o perfil de outro usuário
  else if (selected === 'otherProfile' && viewingProfileUserId) {
      Screen = () => <OtherUserProfileScreen userId={viewingProfileUserId} onBack={handleBackFromOtherProfile} />;
  } else {
      // Caso padrão para evitar tela branca se viewingProfileUserId for null ou selected for inválido
      Screen = FeedScreen;
      setSelected('feed');
      setViewingProfileUserId(null);
  }
  return (
    <SafeAreaProvider>
      <AuthContext.Provider value={{ user, setUser, setSelected, setViewingProfileUserId }}>
        <View style={{ flex: 1, backgroundColor: COLORS.background }}>
          <Screen />
          {/* Oculta a TabBar quando estiver visualizando o perfil de outro */}
          {user && selected !== 'otherProfile' && <TabBar selected={selected} setSelected={setSelected} />}
        </View>
      </AuthContext.Provider>
    </SafeAreaProvider>
  );
}

// --- Estilos ---
const { width, height } = Dimensions.get('window');
const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 70,
    zIndex: 999,
  },
  tabBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopColor: COLORS.primary,
    borderTopWidth: 1,
    flex: 1,
  },
  tabItem: { alignItems: 'center', flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  username: { fontWeight: 'bold', color: COLORS.background, fontSize: 16 },
  description: { color: COLORS.background, fontSize: 15, marginBottom: 4 },
  actionsFull: {
    position: 'absolute',
    right: 18,
    alignItems: 'center',
    gap: 18,
  },
  actionBtn: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: 'transparent',
    borderRadius: 30,
    padding: 10,
    marginBottom: 8,
    alignItems: 'center',
  },
  counter: { color: COLORS.primary, fontWeight: 'bold', fontSize: 13 },
  comment: { color: COLORS.background, fontSize: 13 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: COLORS.background, padding: 22, borderRadius: 14, width: '80%' },
  modalTitle: { fontSize: 20, color: COLORS.primary, fontWeight: 'bold' },
  input: { borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#eafaf1', borderRadius: 8, padding: 10, width: '100%', marginVertical: 8 },
  postBtn: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: 'transparent',
    padding: 13,
    borderRadius: 30,
    marginTop: 10,
    alignItems: 'center',
  },
  link: { color: COLORS.primary, marginTop: 12, fontWeight: 'bold', textAlign: 'center' },
  title: { fontSize: 24, color: COLORS.primary, fontWeight: 'bold', marginBottom: 18, textAlign: 'center' },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: 'transparent',
    borderRadius: 30,
    padding: 12,
    marginBottom: 12,
    justifyContent: 'center',
  },
  uploadText: { marginLeft: 12, color: COLORS.primary, fontWeight: 'bold', fontSize: 17 },
  preview: { marginTop: 18, alignItems: 'center' },
  previewImage: { width: 200, height: 200, borderRadius: 16, marginBottom: 12 },
  videoPreview: {
    width: 200,
    height: 200,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  profileHeader: { alignItems: 'center', marginTop: 30, marginBottom: 18, position: 'relative' },
  profileAvatar: { width: 90, height: 90, borderRadius: 45, borderColor: COLORS.primary, borderWidth: 3 },
  cameraIcon: {
    position: 'absolute',
    bottom: 0,
    right: 25,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  profileName: { fontSize: 22, fontWeight: 'bold', color: COLORS.primary, marginTop: 10 },
  profileUsername: { color: COLORS.darkText, fontSize: 16, marginVertical: 2 },
  profileBio: { color: COLORS.text, textAlign: 'center', marginVertical: 8, fontSize: 15 },
  profileStats: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16, marginTop: 6 },
  statItem: { alignItems: 'center', marginHorizontal: 18 },
  statNum: { fontSize: 19, color: COLORS.primary, fontWeight: 'bold' },
  statLabel: { color: COLORS.darkText, fontSize: 13 },
  editBtn: { // Estilo compartilhado para os botões de ação do perfil
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: 'transparent',
    borderRadius: 30,
    padding: 12,
    // marginTop: 10, // Removido pois agora estão lado a lado
    alignItems: 'center',
    // alignSelf: 'center', // Removido pois agora estão lado a lado
    minWidth: 100, // Largura mínima para consistência
  },
  loginContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: 18 },
  appTitleLogin: { color: COLORS.primary, fontSize: 28, fontWeight: 'bold' },
  loginLabel: { fontSize: 18, color: COLORS.primary, marginTop: 12, fontWeight: 'bold' },
  messagesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  messagesTitle: { fontSize: 22, color: COLORS.primary, fontWeight: 'bold' },
  chatItem: { flexDirection: 'row', alignItems: 'center', padding: 16, marginHorizontal: 16 },
  chatAvatar: { width: 50, height: 50, borderRadius: 25, marginRight: 12 },
  chatInfo: { flex: 1 },
  chatName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  chatMessage: { fontSize: 14, color: COLORS.darkText, marginTop: 2 },
  chatTime: { fontSize: 12, color: COLORS.darkText, opacity: 0.7 },
  separator: { height: 1, backgroundColor: '#eee', marginHorizontal: 16 },
  userPosts: { padding: 16, borderTopWidth: 1, borderTopColor: '#eee', marginTop: 20 },
  postsTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.primary, marginBottom: 12 },
  noPosts: { textAlign: 'center', color: COLORS.darkText, fontSize: 16, marginTop: 20 },
  avatarPicker: { alignItems: 'center', marginBottom: 16 },
  modalAvatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: COLORS.primary },
});
