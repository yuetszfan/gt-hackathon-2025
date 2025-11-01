'use client';

import React from 'react';
import { z } from 'zod';
import {
  useRegisterState,
  useRegisterFrontendTool,
  useSubscribeStateToAgentContext,
} from 'cedar-os';

import { DashboardLayout } from '@/components/medical-device/DashboardLayout';
import { DeviceRegistrationForm } from '@/components/medical-device/DeviceRegistrationForm';
import { SidePanelCedarChat } from '@/cedar/components/chatComponents/SidePanelCedarChat';
import { DebuggerPanel } from '@/cedar/components/debugger';
import { MedicalCategory } from '@/lib/mockData';

interface DeviceFormData {
  name: string;
  company: string;
  description: string;
  companyProductUrl: string;
  tags: MedicalCategory[];
  images: File[];
  clinicalFiles: (File | { url: string; description: string })[];
  researchSummary: string;
}

export default function AddDevicePage() {
  const [formData, setFormData] = React.useState<DeviceFormData>({
    name: '',
    company: '',
    description: '',
    companyProductUrl: '',
    tags: [],
    images: [],
    clinicalFiles: [],
    researchSummary: '',
  });

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<Record<string, string>>({});

  // Register form state for Cedar
  useRegisterState({
    key: 'deviceFormData',
    description: 'Medical device registration form data',
    value: formData,
    setValue: setFormData,
    stateSetters: {
      updateField: {
        name: 'updateField',
        description: 'Update a specific field in the device form',
        argsSchema: z.object({
          field: z.string().describe('Field name to update'),
          value: z.any().describe('New value for the field'),
        }),
        execute: (
          currentData: DeviceFormData,
          setValue: (newValue: DeviceFormData) => void,
          args: { field: string; value: unknown },
        ) => {
          setValue({
            ...currentData,
            [args.field]: args.value,
          });
        },
      },
    },
  });

  // Subscribe form data to Cedar context
  useSubscribeStateToAgentContext(
    'deviceFormData',
    (data: DeviceFormData) => ({
      formCompletion:
        Object.values(data).filter((value) =>
          Array.isArray(value) ? value.length > 0 : Boolean(value),
        ).length / 7, // 7 required fields
      deviceName: data.name,
      company: data.company,
      selectedTags: data.tags,
      hasImages: data.images.length > 0,
      hasClinicalFiles: data.clinicalFiles.length > 0,
    }),
    {
      showInChat: true,
      color: '#0891b2',
    },
  );

  // Function to submit device registration
  const handleDeviceSubmit = async () => {
    setIsSubmitting(true);
    setValidationErrors({});

    try {
      // Validate required fields
      const errors: Record<string, string> = {};
      if (!formData.name) errors.name = 'Device name is required';
      if (!formData.company) errors.company = 'Company name is required';
      if (!formData.description) errors.description = 'Description is required';
      if (!formData.companyProductUrl) errors.companyProductUrl = 'Product URL is required';
      if (formData.tags.length === 0) errors.tags = 'At least one category is required';

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        setIsSubmitting(false);
        return;
      }

      // Prepare form data for submission
      const submitFormData = new FormData();
      submitFormData.append('name', formData.name);
      submitFormData.append('company', formData.company);
      submitFormData.append('description', formData.description);
      submitFormData.append('companyProductUrl', formData.companyProductUrl);
      submitFormData.append('tags', JSON.stringify(formData.tags));
      submitFormData.append('researchSummary', formData.researchSummary);

      // Add image files
      formData.images.forEach((image) => {
        submitFormData.append('images', image);
      });

      // Separate clinical files and URLs
      const clinicalFilesList: File[] = [];
      const clinicalFileUrls: { url: string; description: string }[] = [];
      
      formData.clinicalFiles.forEach((file) => {
        if (file instanceof File) {
          clinicalFilesList.push(file);
        } else {
          clinicalFileUrls.push(file);
        }
      });

      // Add clinical files
      clinicalFilesList.forEach((file) => {
        submitFormData.append('clinicalFiles', file);
      });

      // Add clinical file URLs as JSON
      submitFormData.append('clinicalFileUrls', JSON.stringify(clinicalFileUrls));

      // Submit to API
      const response = await fetch('/api/register-device', {
        method: 'POST',
        body: submitFormData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to register device');
      }

      console.log('Device registered successfully:', result);

      // Redirect to devices page
      window.location.href = '/dashboard/devices';
    } catch (error) {
      setIsSubmitting(false);
      console.error('Failed to register device:', error);
      alert(`Failed to register device: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Frontend tools for form management
  useRegisterFrontendTool({
    name: 'submitDevice',
    description: 'Submit the device registration form',
    argsSchema: z.object({}),
    execute: handleDeviceSubmit,
  });

  const renderContent = () => (
    <DashboardLayout>
      <DeviceRegistrationForm
        formData={formData}
        onFormDataChange={setFormData}
        validationErrors={validationErrors}
        isSubmitting={isSubmitting}
        onSubmit={handleDeviceSubmit}
      />
    </DashboardLayout>
  );

  return (
    <SidePanelCedarChat
      side="right"
      title="Device Registration Assistant"
      collapsedLabel="Chat with AI"
      showCollapsedButton={true}
    >
      <DebuggerPanel />
      {renderContent()}
    </SidePanelCedarChat>
  );
}
