import { createClient } from "@libsql/client"
import { v4 as uuidv4 } from 'uuid'
import morgan from 'morgan'

const express = require('express')
const app = express()
const port = 3000

app.use(express.json())
app.use(morgan('tiny'))

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
})

let goals = []
let tasksByCategory = []
let tasksByDate = []

const tasksOld = [
  [
    '04-17-2024',
    {
      id: 1,
      title: 'Module 11 homework',
      date: '04-17-2024',
      description: 'Read chapters and discuss with group',
      completed: false,
      categoryId: 1
    },
    {
      id: 2,
      title: 'Email professor about extra credit',
      date: '04-17-2024',
      description: '',
      completed: false,
      categoryId: 1
    }
  ],
  [
    '04-18-2024',
    {
      id: 3,
      title: 'Set up girls lunch',
      date: '04-18-2024',
      description: 'Remember to invite Jessica, Mikell, and Avery',
      completed: false,
      categoryId: 5
    }
  ]
]

// Test route
app.get('/testing', async (req, res) => {
  res.send({Hello:'World'})
})

// List goals
app.get('/goals', (req, res) => {
  res.send(goals)
})

// Update goal
app.put('/goals/:id', async (req, res) => {
  const result = await client.execute({
    sql: `UPDATE Goal
          SET title=?, description=?, frequency=?, quantity=?, category=?
          WHERE id=?`,
    args: [
      req.body.title,
      req.body.description,
      req.body.frequency,
      req.body.quantity,
      req.body.category,
      req.params.id
    ]
  })
  console.log(result)
  await loadGoalsFromDatabase()
  
  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.send({message: 'Success'})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Create goal
app.post('/goals', async (req, res) => {
  // Creat a UUID
  let newUuid = uuidv4()

  // Send to the database
  const result = await client.execute({
    sql: `INSERT INTO Goal VALUES(?,?,?,?,?,?)`,
    args: [
      newUuid,
      req.body.title,
      req.body.description,
      req.body.frequency,
      req.body.quantity,
      req.body.category
    ]
  })

  // Reload the data
  await loadGoalsFromDatabase()

  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.status(201).send({message: 'Success', id: req.params.id})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Delete goal
app.delete('/goals/:id', async (req, res) => {
  console.log('deleting a goal for sure')
  console.log('request body')
  console.log(req.body)
  console.log('request headers')
  console.log(req.headers)
  console.log(req.params)

  // First delete from GoalComplete
  await client.execute({
    sql: `DELETE FROM GoalComplete WHERE goalId=?`,
    args: [req.params.id]
  })

  // Delete from database
  const result = await client.execute({
    sql: `DELETE FROM Goal WHERE id=?`,
    args: [req.params.id]
  })

  // Reload data from database for reading
  await loadGoalsFromDatabase()

  // Send a response
  if (result.rowsAffected == 1) {
    res.send({message: `Deleted goal with id ${req.params.id}`})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Update goalComplete
app.put('/goalcomplete/:id/:date', async (req, res) => {
  // Check database to see if update or create
  let completeResult = await client.execute({
    sql: 'SELECT completed FROM goalComplete WHERE goalId=? AND date=?',
    args: [req.params.id, req.params.date]
  })
  
  // If an entry for today doesn't exist, create a record
  let result
  if (completeResult.rows.length === 0) {
    result = await client.execute({
      sql: 'INSERT INTO goalComplete VALUES (?,?,?)',
      args: [
        req.params.id,
        req.params.date,
        req.body.completed
      ]
    })
  } else {
    // Else update the record
    result = await client.execute({
      sql: `UPDATE goalComplete
            SET completed=?
            WHERE goalId=?`,
      args: [
        req.body.completed,
        req.params.id
      ]
    })
  }

  await loadGoalsFromDatabase()
  if (result.rowsAffected == 1) {
    res.send({message: 'Success', newCompleted: req.body.completed})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// List tasks
app.get('/tasks/:type', (req, res) => {
  if (req.params.type == 'category') {
    res.send(tasksByCategory)
  } else if (req.params.type == 'date') {
    res.send(tasksByDate)
  } else {
    res.status(404).send({message: 'Error: Valid type not specified'})
  }
})

// Update task
app.put('/tasks/:id', async (req, res) => {
  const result = await client.execute({
    sql: `UPDATE Task
          SET title=?, date=?, description=?, completed=?, category=?
          WHERE id=?`,
    args: [
      req.body.title,
      req.body.date,
      req.body.description,
      req.body.completed ? 1 : 0,
      req.body.category,
      req.params.id
    ]
  })
  console.log(result)
  await loadTasksFromDatabase()
  
  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.send({message: 'Success'})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Create task
app.post('/tasks', async (req, res) => {
  console.log('in here!!!!')
  // Creat a UUID
  let newUuid = uuidv4()

  // Send to the database
  const result = await client.execute({
    sql: `INSERT INTO Task VALUES(?,?,?,?,?,?)`,
    args: [
      newUuid,
      req.body.title,
      req.body.date,
      req.body.description,
      req.body.completed,
      req.body.category
    ]
  })

  // Reload the data
  await loadTasksFromDatabase()

  // Send a response based on success or failure
  if (result.rowsAffected == 1) {
    res.status(201).send({message: 'Success', id: req.params.id})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

// Delete task
app.delete('/tasks/:id', async (req, res) => {
  console.log('deleting a task')
  // Delete from database
  const result = await client.execute({
    sql: `DELETE FROM Task WHERE id=?`,
    args: [req.params.id]
  })

  // Reload data from database for reading
  await loadTasksFromDatabase()

  // Send a response
  if (result.rowsAffected == 1) {
    res.send({message: `Deleted task with id ${req.params.id}`})
  } else {
    res.status(500).send({message: 'Database error'})
  }
})

app.delete('*', async (req, res) => {
  console.log('deleting somethin for sure')
  console.log('request body')
  console.log(req.body)
  console.log('request headers')
  console.log(req.headers)
  console.log(req.params)
  res.status(404).send({message: 'Oops!'})
})

async function loadGoalsFromDatabase() {
  // Retrieve the goals from the database
  let goalResult = await client.execute('SELECT * FROM Goal')
  let goalsTemp = {}
  let dataRowFormatted = {}

  // Put the results into an object sorted by category
  for (let dataRow of goalResult.rows) {
    dataRowFormatted = {
      id: dataRow.id,
      title: dataRow.title,
      description: dataRow.description,
      frequency: dataRow.frequency,
      quantity: dataRow.quantity,
      category: dataRow.category.toString()
    }

    // Retrieve goal completion number for today, if it exists
    let today = new Date()
    let completeResult = await client.execute({
      sql: 'SELECT completed FROM goalComplete WHERE goalId=? AND date=?',
      args: [dataRowFormatted.id, today.toDateString()]
    })
    if (completeResult.rows.length === 0) {
      dataRowFormatted.completed = 0
    } else {
      dataRowFormatted.completed = completeResult.rows[0].completed
    }

    if (Object.hasOwn(goalsTemp, dataRow.category)) {
      goalsTemp[dataRow.category].push(dataRowFormatted)
    } else {
      goalsTemp[dataRow.category] = [dataRowFormatted]
    }
  }

  // Turn it into the list format the client needs
  goals = []
  for (const property in goalsTemp) {
    let categoryArr = []
    categoryArr.push(property)
    for (const dataItem of goalsTemp[property]) {
      categoryArr.push(dataItem)
    }
    goals.push(categoryArr)
  }
}

async function loadTasksFromDatabase() {
  // Retrieve the goals from the database
  let taskResult = await client.execute('SELECT * FROM Task')
  let categoryTemp = {}
  let dateTemp = {}
  let sortedData = []
  // let dataRowFormatted = {}
  function sortByDate(a, b) {
    let aDate = new Date(a.date)
    let bDate = new Date(b.date)
    return aDate.getTime() - bDate.getTime()
  }

  // Format and then sort by date
  for (let dataRow of taskResult.rows) {
    let dataRowFormatted = {
      id: dataRow.id,
      title: dataRow.title,
      date: dataRow.date,
      description: dataRow.description,
      completed: dataRow.completed == 1,
      category: dataRow.category.toString()
    }
    sortedData.push(dataRowFormatted)
  }
  sortedData.sort(sortByDate)
  
  // Put the results into an object sorted by category
  for (let dataRow of sortedData) {
    // Create an object to store tasks by category
    if (Object.hasOwn(categoryTemp, dataRow.category)) {
      categoryTemp[dataRow.category].push(dataRow)
    } else {
      categoryTemp[dataRow.category] = [dataRow]
    }

    // Create an object to store tasks by date
    if (Object.hasOwn(dateTemp, dataRow.date)) {
      dateTemp[dataRow.date].push(dataRow)
    } else {
      dateTemp[dataRow.date] = [dataRow]
    }
  }

  // Turn it into the list formats the client needs
  tasksByCategory = []
  for (const property in categoryTemp) {
    let categoryArr = []
    categoryArr.push(property)
    for (const dataItem of categoryTemp[property]) {
      categoryArr.push(dataItem)
    }
    tasksByCategory.push(categoryArr)
  }

  tasksByDate = []
  for (const property in dateTemp) {
    let dateArr = []
    dateArr.push(property)
    for (const dataItem of dateTemp[property]) {
      dateArr.push(dataItem)
    }
    tasksByDate.push(dateArr)
  }
}

app.listen(port, async () => {
  console.log('Loading data from database...')
  await loadGoalsFromDatabase()
  await loadTasksFromDatabase()

  console.log(`Server listening on port ${port}`)
})

/* Elephant graveyard */
/*

  // for (let i = 0; i < goals.length; i++) {
  //   for (let j = 0; j < goals[i].length; j++) {
  //     if (Object.hasOwn(goals[i][j], 'id') && goals[i][j].id == req.body.id) {
  //       goals[i][j] = req.body
  //       console.log(`Done! Goal is now ${JSON.stringify(goals[i][j])}`)
  //     }
  //   }
  // }
  // console.log(JSON.stringify(goals))


  //   [
//     'School',
//     {
//       id: 1,
//       title: 'Get A\'s this semester',
//       description: 'Get my GPA up to 3.85',
//       frequency: 'once',
//       quantity: 1,
//       categoryId: 1
//     },
//     {
//       id: 2,
//       title: 'Finish homework before Netflix',
//       description: '',
//       frequency: 'daily',
//       quantity: 1,
//       categoryId: 1
//     }
//   ],
//   [
//     'Physical',
//     {
//       id: 3,
//       title: 'Take a walk twice a day',
//       description: 'At least a quarter mile!',
//       frequency: 'daily',
//       quantity: 2,
//       categoryId: 5
//     }
//   ]


*/