// Validadores comunes para formularios

export const validators = {
  required: (value) => {
    if (!value || (typeof value === "string" && !value.trim())) {
      return "Este campo es obligatorio";
    }
    return null;
  },

  email: (value) => {
    if (!value) return null; // Usar required por separado
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return "Email inválido";
    }
    return null;
  },

  phone: (value) => {
    if (!value) return null;
    
    // Acepta formatos internacionales
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(value)) {
      return "Número de teléfono inválido";
    }
    
    // Verificar que tenga al menos 8 dígitos
    const digitsOnly = value.replace(/\D/g, "");
    if (digitsOnly.length < 8) {
      return "El teléfono debe tener al menos 8 dígitos";
    }
    
    return null;
  },

  minLength: (min) => (value) => {
    if (!value) return null;
    
    if (value.length < min) {
      return `Debe tener al menos ${min} caracteres`;
    }
    return null;
  },

  maxLength: (max) => (value) => {
    if (!value) return null;
    
    if (value.length > max) {
      return `No debe exceder ${max} caracteres`;
    }
    return null;
  },

  password: (value) => {
    if (!value) return null;
    
    if (value.length < 6) {
      return "La contraseña debe tener al menos 6 caracteres";
    }
    
    // Opcional: requerir al menos una letra y un número
    const hasLetter = /[a-zA-Z]/.test(value);
    const hasNumber = /\d/.test(value);
    
    if (!hasLetter || !hasNumber) {
      return "La contraseña debe contener letras y números";
    }
    
    return null;
  },

  passwordMatch: (password) => (confirmPassword) => {
    if (!confirmPassword) return null;
    
    if (password !== confirmPassword) {
      return "Las contraseñas no coinciden";
    }
    return null;
  },

  url: (value) => {
    if (!value) return null;
    
    try {
      new URL(value);
      return null;
    } catch {
      return "URL inválida";
    }
  },

  number: (value) => {
    if (!value && value !== 0) return null;
    
    if (isNaN(value)) {
      return "Debe ser un número";
    }
    return null;
  },

  positiveNumber: (value) => {
    if (!value && value !== 0) return null;
    
    const num = Number(value);
    if (isNaN(num)) {
      return "Debe ser un número";
    }
    
    if (num < 0) {
      return "Debe ser un número positivo";
    }
    
    return null;
  },

  range: (min, max) => (value) => {
    if (!value && value !== 0) return null;
    
    const num = Number(value);
    if (isNaN(num)) {
      return "Debe ser un número";
    }
    
    if (num < min || num > max) {
      return `Debe estar entre ${min} y ${max}`;
    }
    
    return null;
  },
};

// Función para validar múltiples campos
export const validateForm = (values, rules) => {
  const errors = {};
  
  Object.keys(rules).forEach((field) => {
    const fieldRules = Array.isArray(rules[field]) ? rules[field] : [rules[field]];
    const value = values[field];
    
    for (const rule of fieldRules) {
      const error = rule(value);
      if (error) {
        errors[field] = error;
        break; // Solo mostrar el primer error por campo
      }
    }
  });
  
  return errors;
};

// Hook personalizado para validación de formularios
export const useFormValidation = (initialValues, validationRules) => {
  const [values, setValues] = React.useState(initialValues);
  const [errors, setErrors] = React.useState({});
  const [touched, setTouched] = React.useState({});

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setValues((prev) => ({ ...prev, [field]: value }));
    
    // Validar el campo individual si ya fue tocado
    if (touched[field] && validationRules[field]) {
      const fieldRules = Array.isArray(validationRules[field])
        ? validationRules[field]
        : [validationRules[field]];
      
      let error = null;
      for (const rule of fieldRules) {
        error = rule(value);
        if (error) break;
      }
      
      setErrors((prev) => ({ ...prev, [field]: error }));
    }
  };

  const handleBlur = (field) => () => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    
    // Validar el campo cuando pierde el foco
    if (validationRules[field]) {
      const fieldRules = Array.isArray(validationRules[field])
        ? validationRules[field]
        : [validationRules[field]];
      
      let error = null;
      for (const rule of fieldRules) {
        error = rule(values[field]);
        if (error) break;
      }
      
      setErrors((prev) => ({ ...prev, [field]: error }));
    }
  };

  const validateAll = () => {
    const newErrors = validateForm(values, validationRules);
    setErrors(newErrors);
    
    // Marcar todos los campos como tocados
    const allTouched = {};
    Object.keys(validationRules).forEach((field) => {
      allTouched[field] = true;
    });
    setTouched(allTouched);
    
    return Object.keys(newErrors).length === 0;
  };

  const reset = () => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
  };

  return {
    values,
    errors,
    touched,
    handleChange,
    handleBlur,
    validateAll,
    reset,
    setValues,
  };
};

// Ejemplo de uso:
/*
const MyForm = () => {
  const {
    values,
    errors,
    touched,
    handleChange,
    handleBlur,
    validateAll,
  } = useFormValidation(
    { email: "", password: "" },
    {
      email: [validators.required, validators.email],
      password: [validators.required, validators.password],
    }
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateAll()) {
      // Enviar formulario
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <TextField
        value={values.email}
        onChange={handleChange("email")}
        onBlur={handleBlur("email")}
        error={touched.email && !!errors.email}
        helperText={touched.email && errors.email}
      />
    </form>
  );
};
*/
