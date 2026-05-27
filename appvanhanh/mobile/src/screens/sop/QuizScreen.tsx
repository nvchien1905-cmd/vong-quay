import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { sopApi } from '../../api/client';
import Button from '../../components/common/Button';
import Card from '../../components/common/Card';
import { Colors } from '../../utils/colors';

export default function QuizScreen({ route }: any) {
  const { quizId } = route.params;
  const navigation = useNavigation<any>();
  const [quiz, setQuiz] = useState<any>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    sopApi.getQuiz(quizId)
      .then(({ data }) => {
        setQuiz(data.data);
        setAnswers(new Array(data.data.questions.length).fill(-1));
      })
      .catch(() => Alert.alert('Lỗi', 'Không tải được bài kiểm tra'))
      .finally(() => setLoading(false));
  }, [quizId]);

  const selectAnswer = (qIdx: number, aIdx: number) => {
    if (result) return;
    const newAnswers = [...answers];
    newAnswers[qIdx] = aIdx;
    setAnswers(newAnswers);
  };

  const handleSubmit = async () => {
    if (answers.some((a) => a === -1)) {
      Alert.alert('Chưa xong', 'Vui lòng trả lời tất cả câu hỏi');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await sopApi.submitQuiz(quizId, answers);
      setResult(data.data);
    } catch {
      Alert.alert('Lỗi', 'Nộp bài thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!quiz) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.quizTitle}>{quiz.title}</Text>
      <Text style={styles.quizCount}>{quiz.questions.length} câu hỏi</Text>

      {result && (
        <Card style={{ backgroundColor: result.passed ? Colors.success + '20' : Colors.error + '20', marginBottom: 16 }}>
          <View style={styles.resultRow}>
            <Ionicons
              name={result.passed ? 'checkmark-circle' : 'close-circle'}
              size={36}
              color={result.passed ? Colors.success : Colors.error}
            />
            <View style={styles.resultInfo}>
              <Text style={[styles.resultScore, { color: result.passed ? Colors.success : Colors.error }]}>
                {result.score}/100
              </Text>
              <Text style={styles.resultLabel}>
                {result.passed ? 'Đạt! 🎉' : 'Chưa đạt. Hãy ôn lại nhé!'} ({result.correct}/{result.total} câu đúng)
              </Text>
            </View>
          </View>
          <Button title="Quay lại tài liệu" onPress={() => navigation.goBack()} variant="outline" style={{ marginTop: 12 }} />
        </Card>
      )}

      {quiz.questions.map((q: any, qi: number) => (
        <Card key={qi}>
          <Text style={styles.question}>Câu {qi + 1}: {q.question}</Text>
          {q.options.map((opt: string, oi: number) => {
            const selected = answers[qi] === oi;
            return (
              <TouchableOpacity
                key={oi}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => selectAnswer(qi, oi)}
              >
                <View style={[styles.optionCircle, selected && styles.optionCircleSelected]}>
                  {selected && <View style={styles.optionDot} />}
                </View>
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </Card>
      ))}

      {!result && (
        <Button
          title="Nộp bài"
          onPress={handleSubmit}
          loading={submitting}
          style={{ marginTop: 8, marginBottom: 24 }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  quizTitle: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  quizCount: { fontSize: 13, color: Colors.textSecondary, marginBottom: 16 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  resultInfo: { flex: 1 },
  resultScore: { fontSize: 28, fontWeight: '900' },
  resultLabel: { fontSize: 14, color: Colors.text, marginTop: 2 },
  question: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 12, lineHeight: 22 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 8, marginBottom: 4 },
  optionSelected: { backgroundColor: Colors.primary + '15' },
  optionCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  optionCircleSelected: { borderColor: Colors.primary },
  optionDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  optionText: { flex: 1, fontSize: 14, color: Colors.text },
  optionTextSelected: { color: Colors.primary, fontWeight: '600' },
});
