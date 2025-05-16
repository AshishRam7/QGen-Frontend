import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Upload, Button, Form, Input, Select, Card, Typography, Spin, Alert,
  Divider, Tag, Progress, Tooltip, Collapse, Row, Col, Checkbox, InputNumber, Radio
} from 'antd';
import { UploadOutlined, InfoCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined, EditOutlined, SaveOutlined } from '@ant-design/icons';
import './App.css';


const MAX_INTERACTIVE_REGENERATION_ATTEMPTS = 15; // Max attempts for interactive regeneration
const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { Panel } = Collapse;

const API_BASE_URL = 'https://qgen-backend.onrender.com/';

const initialFormValues = {
  academic_level: "Undergraduate",
  major: "Computer Science",
  course_name: "Data Structures and Algorithms",
  taxonomy_level: "Evaluate",
  marks_for_question: "10",
  topics_list: "Breadth First Search, Shortest path",
  retrieval_limit_generation: 15,
  similarity_threshold_generation: 0.4,
  generate_diagrams: false,
};

function App() {
  const [form] = Form.useForm();
  const [file, setFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  
  const initialJobDetails = {
    status: '', message: '', errorDetails: null, jobParams: null,
    originalFilename: null, currentQuestion: null, currentEvaluations: null,
    regenerationAttemptsMade: 0, maxRegenerationAttempts: 15, finalResult: null,
  };
  const [jobDetails, setJobDetails] = useState(initialJobDetails);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [userFeedback, setUserFeedback] = useState("");

  const pollingIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const handleFileChange = (info) => {
    if (info.fileList.length > 0) {
      setFile(info.fileList[0].originFileObj);
    } else {
      setFile(null);
    }
    return false;
  };

  const resetJobState = () => {
    setJobId(null);
    setJobDetails(initialJobDetails);
    setError('');
    setUserFeedback("");
    setFile(null); // Also reset the file
    form.resetFields(); // Reset the antd form
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
  };

  const updateJobDetailsState = (data) => {
    console.log('[App.js] Raw data for updateJobDetailsState:', JSON.stringify(data, null, 2));
    
    setJobDetails(prev => {
        const newState = {
            status: data.status !== undefined ? data.status : prev.status,
            message: data.message !== undefined ? data.message : prev.message,
            errorDetails: data.error_details !== undefined ? data.error_details : prev.errorDetails, // Use !== undefined to allow null
            jobParams: data.job_params !== undefined ? data.job_params : prev.jobParams,
            originalFilename: data.original_filename !== undefined ? data.original_filename : prev.originalFilename,
            currentQuestion: data.current_question !== undefined ? data.current_question : prev.currentQuestion,
            currentEvaluations: data.current_evaluations !== undefined ? data.current_evaluations : prev.currentEvaluations,
            regenerationAttemptsMade: data.regeneration_attempts_made !== undefined ? data.regeneration_attempts_made : prev.regenerationAttemptsMade,
            maxRegenerationAttempts: data.max_regeneration_attempts !== undefined ? data.max_regeneration_attempts : prev.maxRegenerationAttempts,
            finalResult: data.final_result !== undefined ? data.final_result : prev.finalResult,
        };
        console.log('[App.js] New jobDetails state constructed:', JSON.stringify(newState, null, 2));
        return newState;
    });

    if (['completed', 'error', 'awaiting_feedback', 'max_attempts_reached'].includes(data.status)) {
      setIsLoading(false);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    } else {
      setIsLoading(true);
    }

    if (data.status === 'error' && (data.message || data.error_details)) {
        setError(data.message || data.error_details);
    } else if (data.status !== 'error' && error) { // Clear general error if status is not error
        setError('');
    }
  };


  const handleSubmit = async (values) => {
    if (!file) {
      setError('Please upload a PDF file.');
      return;
    }
    resetJobState(); // Reset most states, but form values are from `values`
    setIsLoading(true);
    setUploading(true);
    setError('');
    // Set initial status for UI feedback
    setJobDetails(prev => ({ ...initialJobDetails, status: 'uploading', message: 'Uploading PDF and submitting job...' }));


    const formData = new FormData();
    formData.append('file', file);
    Object.keys(values).forEach(key => {
      formData.append(key, values[key]);
    });

    try {
      const response = await axios.post(`${API_BASE_URL}/generate-questions`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploading(false);
      setJobId(response.data.job_id);
      // Update jobDetails with info from this response before polling starts
      setJobDetails(prev => ({ ...prev, status: 'queued', message: response.data.message || 'Job submitted, processing...' }));
      startPolling(response.data.job_id);
    } catch (err) {
      setUploading(false);
      setIsLoading(false);
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to submit job.';
      setError(errorMsg);
      setJobDetails(prev => ({ ...prev, status: 'error', message: errorMsg, errorDetails: errorMsg }));
      console.error('Submit error:', err);
    }
  };

  const fetchJobStatus = async (currentJobId) => {
    if (!currentJobId) return;
    try {
      const response = await axios.get(`${API_BASE_URL}/job-status/${currentJobId}`);
      console.log('[App.js] Raw /job-status response data from polling:', JSON.stringify(response.data, null, 2));
      updateJobDetailsState(response.data);
    } catch (err) {
      console.error('[App.js] Error fetching job status during polling:', err);
      const errorMsg = err.response?.data?.detail || err.message || 'Error fetching job status.';
      if (err.response?.status === 404) {
        setError(`Job ID ${currentJobId} not found. Polling stopped.`);
        setJobDetails(prev => ({ ...prev, status: 'error', message: 'Job not found.', errorDetails: errorMsg }));
        setIsLoading(false);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      } else {
        // For other polling errors, you might want to show a less intrusive error or just log
        // setError(`Polling error: ${errorMsg}. Retrying...`); // This might be too noisy
      }
    }
  };

  const startPolling = (currentJobId) => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    fetchJobStatus(currentJobId); 
    pollingIntervalRef.current = setInterval(() => fetchJobStatus(currentJobId), 5000);
  };


  const handleRegenerate = async () => {
    if (!jobId || !userFeedback.trim()) {
        setError("Please provide feedback before regenerating.");
        return;
    }
    setIsLoading(true);
    setError('');
    setJobDetails(prev => ({...prev, status: 'regenerating_question', message: 'Submitting feedback and regenerating question...'}));

    try {
        const response = await axios.post(`${API_BASE_URL}/regenerate-question/${jobId}`, { user_feedback: userFeedback });
        console.log('[App.js] Raw /regenerate-question response data:', JSON.stringify(response.data, null, 2));
        updateJobDetailsState(response.data);
        setUserFeedback(""); 
    } catch (err) {
        console.error('[App.js] Error regenerating question:', err);
        const errorMsg = err.response?.data?.detail || err.message || 'Failed to regenerate question.';
        setError(errorMsg);
        // Revert status to allow user to try again or see error
        setJobDetails(prev => ({...prev, status: 'awaiting_feedback', message: `Regeneration failed: ${errorMsg}`, errorDetails: errorMsg}));
        setIsLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!jobId || !jobDetails.currentQuestion) {
        setError("No current question to finalize.");
        return;
    }
    setIsLoading(true);
    setError('');
    setJobDetails(prev => ({...prev, status: 'finalizing', message: 'Finalizing question...'}));

    try {
        const response = await axios.post(`${API_BASE_URL}/finalize-question/${jobId}`, { final_question: jobDetails.currentQuestion });
        console.log('[App.js] Raw /finalize-question response data:', JSON.stringify(response.data, null, 2));
        updateJobDetailsState(response.data); 
    } catch (err) {
        console.error('[App.js] Error finalizing question:', err);
        const errorMsg = err.response?.data?.detail || err.message || 'Failed to finalize question.';
        setError(errorMsg);
        setJobDetails(prev => ({...prev, status: 'awaiting_feedback', message: `Finalization failed: ${errorMsg}`, errorDetails: errorMsg}));
        setIsLoading(false);
    }
  };


  const renderStatusIcon = () => {
    const status = jobDetails.status;
    if (isLoading && ['processing_setup', 'queued', 'uploading', 'generating_initial_question', 'regenerating_question', 'finalizing'].includes(status)) {
      return <Spin style={{ marginRight: 8 }} />;
    }
    switch (status) {
      case 'completed': return <CheckCircleOutlined style={{ color: 'green', marginRight: 8 }} />;
      case 'error': return <CloseCircleOutlined style={{ color: 'red', marginRight: 8 }} />;
      case 'awaiting_feedback':
      case 'max_attempts_reached':
        return <EditOutlined style={{ color: '#1890ff', marginRight: 8 }} />;
      case 'queued':
      case 'processing_setup':
      case 'generating_initial_question':
      case 'uploading':
      case 'regenerating_question':
      case 'finalizing':
        return <ClockCircleOutlined style={{ color: 'orange', marginRight: 8 }} />;
      default: return null;
    }
  };

  const renderContextSnippets = (snippets, type) => {
    if (!snippets || snippets.length === 0) {
      return <Paragraph>No {type} context snippets available.</Paragraph>;
    }
    return (
      <Collapse accordion>
        {snippets.map((snippet, index) => (
          <Panel
            header={`Snippet ${index + 1} (Score: ${snippet.score?.toFixed(4) || 'N/A'}) - Source: ${snippet.payload?.metadata?.source_file || 'N/A'}`}
            key={`${type}-${snippet.id || snippet.payload?.metadata?.final_chunk_index || index}`} // Use more stable key if id is missing
          >
             {snippet.payload?.metadata?.header_trail && snippet.payload.metadata.header_trail.length > 0 &&
                <Paragraph><Text strong>Header Trail:</Text> {snippet.payload.metadata.header_trail.join(' -> ')}</Paragraph>
              }
            <div className="snippet-code">{snippet.payload?.text || "No text in snippet."}</div>
          </Panel>
        ))}
      </Collapse>
    );
  };
  
  const renderImageDescriptionSlideshow = (allSnippets) => {
    if (!allSnippets || allSnippets.length === 0) {
        return <Paragraph>No context snippets available to check for image descriptions.</Paragraph>;
    }
    const imageDescriptionSnippets = allSnippets.filter(snippet =>
        snippet.payload?.text && snippet.payload.text.includes("**Figure Description (Generated by Moondream):**")
    );
    if (imageDescriptionSnippets.length === 0) {
        return <Paragraph>No distinct image descriptions found in the provided context snippets.</Paragraph>;
    }
    return (
        <Collapse accordion>
            {imageDescriptionSnippets.map((snippet, index) => {
                let title = `Image Description ${index + 1}`;
                const titleMatch = snippet.payload.text.match(/^###\s*(.*)/m);
                if (titleMatch && titleMatch[1]) title = titleMatch[1].replace(/\*\*Figure Description.*?---/, '').trim();
                
                const descriptionMatch = snippet.payload.text.match(/\*\*Figure Description \(Generated by Moondream\):\*\*\s*([\s\S]*?)\s*---/m);
                const descriptionText = descriptionMatch && descriptionMatch[1] ? descriptionMatch[1].trim() : "Could not extract description.";
                
                const originalRefMatch = snippet.payload.text.match(/\*\*Original Image Reference.*?\*\*\s*`([^`]+)`/m);
                const originalRef = originalRefMatch && originalRefMatch[1] ? originalRefMatch[1] : "N/A";
                
                return (
                    <Panel header={title || `Image ${index + 1}`} key={`img-desc-${snippet.id || snippet.payload?.metadata?.final_chunk_index || index}`}>
                        <Paragraph><Text strong>Original Ref:</Text> <Text code>{originalRef}</Text></Paragraph>
                        <Paragraph strong>Moondream Description:</Paragraph>
                        <div className="snippet-code">{descriptionText}</div>
                    </Panel>
                );
            })}
        </Collapse>
    );
};

  const canRegenerate = (jobDetails.status === 'awaiting_feedback' || jobDetails.status === 'max_attempts_reached') && jobDetails.regenerationAttemptsMade < jobDetails.maxRegenerationAttempts;
  const canFinalize = (jobDetails.status === 'awaiting_feedback' || jobDetails.status === 'max_attempts_reached') && jobDetails.currentQuestion && !jobDetails.currentQuestion.startsWith("Error:");


  return (
    <div className="container">
      <Card>
        <Title level={2} style={{ textAlign: 'center', marginBottom: 30 }}>
          Bloom's taxnonomy based question generation
        </Title>

        {(!jobId || jobDetails.status === 'error' || jobDetails.status === 'completed') && (
        <Form
          form={form} layout="vertical" onFinish={handleSubmit} initialValues={initialFormValues}
        >
          <Title level={4}>1. Upload PDF Document</Title>
          <Form.Item name="file_upload" rules={[{ required: true, message: 'Please upload a PDF file!' }]}>
            <Upload name="file" beforeUpload={() => false} onChange={handleFileChange} maxCount={1} accept=".pdf" fileList={file ? [{ uid: '-1', name: file.name, status: 'done' }] : []}>
              <Button icon={<UploadOutlined />}>Click to Upload PDF</Button>
            </Upload>
          </Form.Item>
          <Divider />
          <Title level={4}>2. Configure Generation Parameters</Title>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item label="Academic Level" name="academic_level" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Major/Field" name="major" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Form.Item label="Course Name" name="course_name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Bloom's Taxonomy Level" name="taxonomy_level" rules={[{ required: true }]}>
            <Select>{["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"].map(l => <Option key={l} value={l}>{l}</Option>)}</Select>
          </Form.Item>
           <Form.Item label="Marks for Question" name="marks_for_question" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value="5">5 Marks</Radio.Button>
              <Radio.Button value="10">10 Marks</Radio.Button>
              <Radio.Button value="15">15 Marks</Radio.Button>
              <Radio.Button value="20">20 Marks</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="Key Topics (comma-separated)" name="topics_list" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item label="Retrieval Limit (Ctx Gen)" name="retrieval_limit_generation" rules={[{ type: 'number', min:1 }]}><InputNumber style={{width: '100%'}} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Similarity Threshold (Ctx Gen)" name="similarity_threshold_generation" rules={[{type: 'number', min:0, max:1}]}><InputNumber step="0.01" style={{width: '100%'}} /></Form.Item></Col>
          </Row>
          <Form.Item name="generate_diagrams" valuePropName="checked">
            <Checkbox>Generate PlantUML Diagrams <Tooltip title="Backend Moondream image description is active. PlantUML generation is a potential future feature."><InfoCircleOutlined style={{ marginLeft: 8 }} /></Tooltip></Checkbox>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isLoading && uploading} disabled={uploading} block size="large">
              {uploading ? 'Uploading...' : (isLoading && jobId ? 'Processing...' : 'Start Generation Process')}
            </Button>
          </Form.Item>
        </Form>
        )}
        <Divider />

        {error && <Alert message={error} type="error" showIcon closable onClose={() => setError('')} style={{ marginBottom: 20 }} />}

        {jobId && (
          <Card title="Job Progress & Interaction" className="status-card">
            <Paragraph><strong>Job ID:</strong> <Text code>{jobId}</Text></Paragraph>
             {jobDetails.originalFilename && <Paragraph><strong>Document:</strong> {jobDetails.originalFilename}</Paragraph>}
            <Paragraph>
              <strong>Status:</strong> {renderStatusIcon()}
              <Tag color={
                jobDetails.status === 'completed' ? 'green' :
                jobDetails.status === 'error' ? 'red' :
                ['awaiting_feedback', 'max_attempts_reached'].includes(jobDetails.status) ? 'blue' :
                (jobDetails.status && jobDetails.status !== '') ? 'orange' : 'default'
              }>
                {jobDetails.status ? jobDetails.status.replace(/_/g, ' ').toUpperCase() : 'INITIALIZING'}
              </Tag>
            </Paragraph>
            <Paragraph><strong>Message:</strong> {jobDetails.message || 'Waiting for updates...'}</Paragraph>
            {jobDetails.jobParams && <Paragraph><strong>Marks:</strong> {jobDetails.jobParams.marks_for_question}</Paragraph>}
            {(isLoading && !['awaiting_feedback', 'max_attempts_reached', 'completed', 'error'].includes(jobDetails.status)) && <Progress percent={50} status="active" showInfo={false} />}
            {jobDetails.errorDetails && <Alert message={<><strong>Error Details:</strong> {jobDetails.errorDetails}</>} type="error" showIcon style={{marginTop:15}} /> }
            
            {jobDetails.currentQuestion && (
              <div style={{marginTop: 20}}>
                <Title level={5}>Current Generated Question (Attempt {jobDetails.regenerationAttemptsMade || 0}/{jobDetails.maxRegenerationAttempts || MAX_INTERACTIVE_REGENERATION_ATTEMPTS}):</Title>
                <Paragraph className="snippet-code" style={{fontSize: '1em', padding: 15, marginBottom: 20}}>
                  {jobDetails.currentQuestion}
                </Paragraph>

                {jobDetails.currentEvaluations && (
                  <>
                    <Divider>Current Evaluation</Divider>
                    {jobDetails.currentEvaluations.generation_status_message && (
                        <Alert message={<><Text strong>Outcome:</Text> {jobDetails.currentEvaluations.generation_status_message}</>} type="info" showIcon style={{marginBottom:15}}/>
                    )}
                     {jobDetails.currentEvaluations.error_message && ( // Error from LLM question generation attempt
                        <Alert message={<><Text strong>LLM Generation Error:</Text> {jobDetails.currentEvaluations.error_message}</>} type="warning" showIcon style={{marginBottom:15}}/>
                    )}
                    {jobDetails.currentEvaluations.error_message_regeneration && ( // Error specifically from regeneration step
                        <Alert message={<><Text strong>Regeneration Error:</Text> {jobDetails.currentEvaluations.error_message_regeneration}</>} type="warning" showIcon style={{marginBottom:15}}/>
                    )}
                    <div className="metric-item">
                      <Text strong>QSTS Score:</Text> {jobDetails.currentEvaluations.qsts_score?.toFixed(4) || 'N/A'}
                    </div>
                    {jobDetails.currentEvaluations.llm_answerability && (
                      <>
                        <div className="metric-item">
                          <Text strong>LLM Answerable:</Text>
                          {jobDetails.currentEvaluations.llm_answerability.is_answerable === true ? <Tag color="green">ANSWERABLE</Tag> :
                           jobDetails.currentEvaluations.llm_answerability.is_answerable === false ? <Tag color="red">NOT ANSWERABLE</Tag> : 'N/A'}
                        </div>
                        <div className="metric-item">
                          <Text strong>Reasoning:</Text> {jobDetails.currentEvaluations.llm_answerability.reasoning || 'N/A'}
                        </div>
                      </>
                    )}
                    {jobDetails.currentEvaluations.qualitative_metrics && Object.entries(jobDetails.currentEvaluations.qualitative_metrics).map(([key, value]) => (
                       key !== "error_message" && // Don't render nested error_message here
                       <div className="metric-item" key={key}>
                         <Text strong>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:</Text>
                         {typeof value === 'boolean' ? (value ? <Tag color="success">PASS</Tag> : <Tag color="error">FAIL</Tag>) : String(value)}
                       </div>
                    ))}
                    {jobDetails.currentEvaluations.qualitative_metrics?.error_message && ( // Error from qualitative eval LLM
                        <Alert message={<><Text strong>Qualitative Eval LLM Error:</Text> {jobDetails.currentEvaluations.qualitative_metrics.error_message}</>} type="warning" showIcon style={{marginTop:15}}/>
                    )}
                  </>
                )}
                
                {(jobDetails.status === 'awaiting_feedback' || jobDetails.status === 'max_attempts_reached') && (
                <div style={{marginTop: 20}}>
                    <Title level={5}>Your Feedback for Regeneration:</Title>
                    <Input.TextArea 
                        rows={3} 
                        value={userFeedback} 
                        onChange={(e) => setUserFeedback(e.target.value)}
                        placeholder="e.g., 'Make the question more specific to topic X', 'The question is too easy/hard', 'Focus on analysis rather than recall.'"
                        disabled={!canRegenerate || isLoading}
                    />
                    <Row gutter={16} style={{marginTop: 15}}>
                        <Col>
                            <Button 
                                type="dashed" 
                                icon={<EditOutlined />} 
                                onClick={handleRegenerate} 
                                loading={isLoading && jobDetails.status === 'regenerating_question'}
                                disabled={!canRegenerate || !userFeedback.trim() || isLoading}
                            >
                                Regenerate ({ (jobDetails.maxRegenerationAttempts || 0) - (jobDetails.regenerationAttemptsMade || 0)} left)
                            </Button>
                        </Col>
                        <Col>
                            <Button 
                                type="primary" 
                                icon={<SaveOutlined />} 
                                onClick={handleFinalize} 
                                loading={isLoading && jobDetails.status === 'finalizing'}
                                disabled={!canFinalize || isLoading}
                            >
                                Finalize This Question
                            </Button>
                        </Col>
                    </Row>
                     {jobDetails.status === 'max_attempts_reached' && (jobDetails.regenerationAttemptsMade || 0) >= (jobDetails.maxRegenerationAttempts || MAX_INTERACTIVE_REGENERATION_ATTEMPTS) && (
                        <Alert message="Maximum regeneration attempts reached. You can only finalize the current question or start a new job." type="warning" showIcon style={{marginTop:15}} />
                    )}
                </div>
                )}
              </div>
            )} {/* End currentQuestion block */}
            
            {jobDetails.finalResult && jobDetails.status === 'completed' && (
              <Card title="Final Result" className="result-card" style={{marginTop: 20}}>
                <Title level={5}>Final Generated Question:</Title>
                <Paragraph className="snippet-code" style={{fontSize: '1em', padding: 15, marginBottom: 20}}>
                  {jobDetails.finalResult.generated_question || "N/A"}
                </Paragraph>
                 <Divider>Final Evaluation Metrics</Divider>
                 {jobDetails.finalResult.evaluation_metrics && (
                    <>
                    {jobDetails.finalResult.evaluation_metrics.generation_status_message && (
                        <Alert message={<><Text strong>Outcome:</Text> {jobDetails.finalResult.evaluation_metrics.generation_status_message}</>} type="info" showIcon style={{marginBottom:15}}/>
                    )}
                    {/* Render other metrics similar to currentEvaluations block */}
                     <div className="metric-item">
                      <Text strong>QSTS Score:</Text> {jobDetails.finalResult.evaluation_metrics.qsts_score?.toFixed(4) || 'N/A'}
                    </div>
                    {jobDetails.finalResult.evaluation_metrics.llm_answerability && (
                      <>
                        <div className="metric-item">
                          <Text strong>LLM Answerable:</Text>
                          {jobDetails.finalResult.evaluation_metrics.llm_answerability.is_answerable === true ? <Tag color="green">ANSWERABLE</Tag> :
                           jobDetails.finalResult.evaluation_metrics.llm_answerability.is_answerable === false ? <Tag color="red">NOT ANSWERABLE</Tag> : 'N/A'}
                        </div>
                        <div className="metric-item">
                          <Text strong>Reasoning:</Text> {jobDetails.finalResult.evaluation_metrics.llm_answerability.reasoning || 'N/A'}
                        </div>
                      </>
                    )}
                    {jobDetails.finalResult.evaluation_metrics.qualitative_metrics && Object.entries(jobDetails.finalResult.evaluation_metrics.qualitative_metrics).map(([key, value]) => (
                       key !== "error_message" &&
                       <div className="metric-item" key={`final-${key}`}>
                         <Text strong>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:</Text>
                         {typeof value === 'boolean' ? (value ? <Tag color="success">PASS</Tag> : <Tag color="error">FAIL</Tag>) : String(value)}
                       </div>
                    ))}
                    </>
                 )}
                 <Paragraph><Text strong>Total regenerations attempts for this result:</Text> {jobDetails.finalResult.total_regeneration_attempts_made}</Paragraph>
                 
                 <Divider>Image Content Descriptions (from Moondream, if present in context)</Divider>
                 {renderImageDescriptionSlideshow(jobDetails.finalResult.generation_context_snippets_metadata || [])}

                 <Divider>Context Snippets (Used for Final Question)</Divider>
                 <Title level={5}>Generation Context (Top 5):</Title>
                 {renderContextSnippets(jobDetails.finalResult.generation_context_snippets_metadata?.slice(0,5), "final-gen")}
                 
                 {jobDetails.finalResult.answerability_context_snippets_metadata && jobDetails.finalResult.answerability_context_snippets_metadata.length > 0 && (
                    <>
                    <Title level={5} style={{marginTop: 20}}>Answerability Context (Top 5):</Title>
                    {renderContextSnippets(jobDetails.finalResult.answerability_context_snippets_metadata?.slice(0,5), "final-ans")}
                    </>
                 )}
                 
                 <Button type="primary" onClick={resetJobState} style={{marginTop: 20}}>Start New Job</Button>
              </Card>
            )}
          </Card>
        )}
      </Card>
    </div>
  );
}

export default App;